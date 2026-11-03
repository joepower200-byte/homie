/* Homie pairing.
   The display shows a QR code holding a six-digit pairing code. The phone scans it (or the code is typed),
   then the phone picks a random confirmation code that both screens show. Tapping Confirm on the phone pairs them.
   Shared state lives in one Supabase row per pairing: docs(home = "pairing-<code>", path = "session"). */
(function () {
  "use strict";
  var MODE = document.body.getAttribute("data-mode");
  var CFG = window.HOMIE_CONFIG || {};
  var BASE = location.origin + location.pathname.replace(/[^/]*$/, "");
  var PHONE_URL = BASE + "phone.html";
  var EXPIRES_MS = 10 * 60 * 1000;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Layout: scale the design-sized stage to fit the screen ---------- */
  var stage = document.querySelector(".stage");
  function fit() {
    if (!stage) return;
    var w = +stage.getAttribute("data-w"), h = +stage.getAttribute("data-h");
    var s = Math.min(window.innerWidth / w, window.innerHeight / h);
    stage.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  /* Screen changes: the old screen fades out, the new one eases in part by part. */
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var current = null, pending = null;
  function show(id) {
    var next = $(id);
    if (pending) { clearTimeout(pending.t); pending.run(); }
    if (current === next) return;
    var prev = current; current = next;
    var run = function () {
      pending = null;
      var all = document.querySelectorAll(".screen");
      for (var i = 0; i < all.length; i++) if (all[i] !== next) { all[i].hidden = true; all[i].classList.remove("leave", "enter"); }
      for (var j = 0; j < next.children.length; j++) next.children[j].style.setProperty("--i", j);
      next.classList.remove("enter"); next.hidden = false; void next.offsetWidth; next.classList.add("enter");
    };
    if (prev && !prev.hidden && !reduced) { prev.classList.add("leave"); pending = { run: run, t: setTimeout(run, 200) }; }
    else run();
  }
  /* Phones without rounded screen corners (e.g. iPhone SE) get squarer panels. */
  if (MODE === "phone") {
    var probe = document.createElement("div");
    probe.style.cssText = "position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden";
    document.body.appendChild(probe);
    var rounded = probe.offsetHeight > 0 || !/iPhone|iPad|Android/.test(navigator.userAgent);
    probe.remove();
    if (!rounded) document.body.classList.add("square-screen");
  }
  var toastTimer;
  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function randomDigits(n) {
    var out = "", r = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < n; i++) out += String(r[i] % 10);
    return out.charAt(0) === "0" ? "1" + out.slice(1) : out;
  }
  function deviceName() {
    var u = navigator.userAgent;
    return /iPhone/.test(u) ? "iPhone" : /Android/.test(u) ? "Android phone" : "phone";
  }

  /* ---------- Shared pairing state (Supabase) ---------- */
  var sb = null;
  if (window.supabase && CFG.supabaseUrl && CFG.supabaseAnonKey) sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  var room = function (code) { return "pairing-" + code; };

  function readSession(code) {
    return sb.from("docs").select("data").eq("home", room(code)).eq("path", "session").limit(1).then(function (res) {
      if (res.error) throw res.error;
      return res.data && res.data[0] ? res.data[0].data : null;
    });
  }
  function writeSession(code, data) {
    return sb.from("docs").upsert({ home: room(code), path: "session", data: data, updated_at: new Date().toISOString() }).then(function (res) {
      if (res.error) throw res.error;
    });
  }
  /* Live updates, plus a light poll in case the live feed is slow to connect. */
  function watchSession(code, fn) {
    var ch = sb.channel("pair-" + code + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "home=eq." + room(code) }, function (p) {
        if (p["new"] && p["new"].data) fn(p["new"].data);
      }).subscribe();
    var timer = setInterval(function () { readSession(code).then(function (d) { if (d) fn(d); }).catch(function () {}); }, 2000);
    return function () { clearInterval(timer); try { sb.removeChannel(ch); } catch (e) {} };
  }

  /* =====================================================================
     DISPLAY (iPad)
     ===================================================================== */
  if (MODE === "display") {
    var D = null;

    var qrSvg = function (text) {
      var q = qrcode(0, "M"); q.addData(text); q.make();
      var n = q.getModuleCount(), size = 286, cell = size / n, out = [];
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (q.isDark(r, c)) out.push('<rect x="' + (c * cell).toFixed(3) + '" y="' + (r * cell).toFixed(3) + '" width="' + (cell + 0.4).toFixed(3) + '" height="' + (cell + 0.4).toFixed(3) + '"/>');
      }
      return '<svg viewBox="0 0 ' + size + " " + size + '" width="286" height="286" shape-rendering="crispEdges" aria-hidden="true"><g fill="#a3a3a3">' + out.join("") + "</g></svg>";
    };

    var stopPairing = function () { if (D && D.stop) D.stop(); D = null; };

    var startPairing = function () {
      stopPairing();
      if (!sb) { $("errorText").textContent = "Homie isn't set up yet: config.js is missing its Supabase settings."; show("error"); return; }
      var code = randomDigits(6);
      D = { code: code, state: "waiting" };
      $("qr").innerHTML = qrSvg(PHONE_URL + "#pair-" + code);
      $("manualDigits").textContent = code.slice(0, 3) + " " + code.slice(3);
      setManual(false);
      show("scan");
      writeSession(code, { status: "waiting", createdAt: Date.now() }).then(function () {
        if (!D || D.code !== code) return;
        D.stop = watchSession(code, function (s) {
          if (!D || D.code !== code) return;
          if (s.status === "joined" && D.state === "waiting" && s.confirm) {
            D.state = "confirm";
            $("confirmCode").textContent = s.confirm.slice(0, 3) + " - " + s.confirm.slice(3);
            show("confirm");
          }
          if (s.status === "paired" && D.state !== "paired") {
            D.state = "paired";
            $("pairedTitle").textContent = "Paired with your " + (s.phone || "phone");
            show("paired");
            D.stop();
          }
          if (s.status === "rejected" && D.state !== "paired") {
            toast("The codes didn't match, so here's a new QR code.");
            startPairing();
          }
        });
        // A fresh code every 10 minutes so an old photo of the screen can't be used.
        D.expiry = setTimeout(function () { if (D && D.code === code && D.state === "waiting") startPairing(); }, EXPIRES_MS - 15000);
      }).catch(function () {
        $("errorText").textContent = "Check this device is online, then try again.";
        show("error");
      });
    };

    var manualOn = false;
    var setManual = function (on) {
      manualOn = on;
      $("qr").hidden = on;
      $("manualCode").hidden = !on;
      $("manualLabel").textContent = on ? "Show QR code" : "Enter manually";
    };

    $("getStarted").addEventListener("click", startPairing);
    $("signIn").addEventListener("click", function () { toast("Sign in is coming soon. Tap Get started to pair."); });
    $("manualToggle").addEventListener("click", function () { setManual(!manualOn); });
    $("pairedDone").addEventListener("click", function () { stopPairing(); show("start"); });
    $("errorRetry").addEventListener("click", startPairing);
    show("start");
  }

  /* =====================================================================
     PHONE
     ===================================================================== */
  if (MODE === "phone") {
    var P = { code: null, stream: null, raf: 0, scanning: false };
    var video = $("video");

    var stopCamera = function () {
      P.scanning = false;
      cancelAnimationFrame(P.raf);
      if (P.stream) { P.stream.getTracks().forEach(function (t) { t.stop(); }); P.stream = null; }
    };
    var camNote = function (text) { $("camNoteText").textContent = text; $("camNote").hidden = !text; };

    var startCamera = function () {
      stopCamera();
      camNote("");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camNote("This browser can't use the camera. Tap “Enter code instead”."); return; }
      $("camera").classList.remove("live", "found");
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (stream) {
        P.stream = stream; video.srcObject = stream;
        video.onplaying = function () { $("camera").classList.add("live"); };
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        P.scanning = true; scanLoop();
      }).catch(function (e) {
        camNote(e && e.name === "NotAllowedError" ? "Camera access is off. Allow it in Settings, or tap “Enter code instead”." : "The camera couldn't start. Tap “Enter code instead”.");
      });
    };

    var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    var detector = ("BarcodeDetector" in window) ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    var busy = false, lastWarn = 0;
    var handleText = function (text) {
      var m = /#pair-(\d{6})\s*$/.exec(String(text || ""));
      if (m) {
        P.scanning = false; $("camera").classList.add("found");
        if (navigator.vibrate) navigator.vibrate(30);
        setTimeout(function () { stopCamera(); join(m[1]); }, reduced ? 0 : 450);
        return true;
      }
      if (Date.now() - lastWarn > 3000) { lastWarn = Date.now(); toast("That isn't a Homie code."); }
      return false;
    };
    var scanLoop = function () {
      if (!P.scanning) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        var done = function (text) { busy = false; if (text && handleText(text)) return; if (P.scanning) P.raf = requestAnimationFrame(scanLoop); };
        if (detector) {
          detector.detect(video).then(function (r) { done(r && r[0] ? r[0].rawValue : null); }).catch(function () { detector = null; done(null); });
          return;
        }
        try {
          var w = Math.min(720, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
          canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
          var r = window.jsQR ? window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" }) : null;
          done(r ? r.data : null);
        } catch (e) { done(null); }
        return;
      }
      P.raf = requestAnimationFrame(scanLoop);
    };

    var fail = function (title, text) { stopCamera(); $("errorTitle").textContent = title; $("errorText").textContent = text; show("error"); };

    var join = function (code) {
      if (!sb) { fail("Homie isn't set up yet.", "config.js is missing its Supabase settings"); return; }
      P.code = code;
      readSession(code).then(function (s) {
        if (!s || s.status !== "waiting" || Date.now() - (s.createdAt || 0) > EXPIRES_MS) {
          fail("This code has expired.", "Show a new code on the display and scan again"); return;
        }
        var confirm = randomDigits(6);
        return writeSession(code, { status: "joined", createdAt: s.createdAt, confirm: confirm, phone: deviceName(), joinedAt: Date.now() }).then(function () {
          $("confirmCode").textContent = confirm.slice(0, 3) + " - " + confirm.slice(3);
          P.confirm = confirm;
          show("confirm");
        });
      }).catch(function () { fail("Homie can't connect right now.", "Check your phone is online and try again"); });
    };

    $("confirmYes").addEventListener("click", function () {
      var btn = this; btn.disabled = true;
      writeSession(P.code, { status: "paired", confirm: P.confirm, phone: deviceName(), pairedAt: Date.now() }).then(function () {
        $("pairedTitle").textContent = "Your display is paired.";
        show("paired");
        try { history.replaceState(null, "", location.pathname); } catch (e) {}
      }).catch(function () { toast("That didn't go through. Try again."); }).then(function () { btn.disabled = false; });
    });
    $("confirmNo").addEventListener("click", function () {
      writeSession(P.code, { status: "rejected", at: Date.now() }).catch(function () {});
      toast("Cancelled. The display will show a new code.");
      goScan();
    });

    var goScan = function () { try { history.replaceState(null, "", location.pathname); } catch (e) {} show("scan"); startCamera(); };
    $("pairAnother").addEventListener("click", goScan);
    $("errorRetry").addEventListener("click", goScan);
    $("typeCode").addEventListener("click", function () { stopCamera(); show("manual"); $("codeInput").value = ""; $("codeGo").disabled = true; setTimeout(function () { $("codeInput").focus(); }, 50); });
    $("backToScan").addEventListener("click", goScan);

    var digitsOf = function (v) { return String(v).replace(/\D/g, "").slice(0, 6); };
    $("codeInput").addEventListener("input", function () {
      var d = digitsOf(this.value);
      this.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d;
      $("codeGo").disabled = d.length !== 6;
    });
    $("codeInput").addEventListener("keydown", function (e) { if (e.key === "Enter" && !$("codeGo").disabled) $("codeGo").click(); });
    $("codeGo").addEventListener("click", function () { var d = digitsOf($("codeInput").value); if (d.length === 6) join(d); });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopCamera();
      else if (!$("scan").hidden) startCamera();
    });

    var start = /^#pair-(\d{6})$/.exec(location.hash);
    if (start) join(start[1]); else { show("scan"); startCamera(); }

    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
