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

  function readDoc(home, path) {
    return sb.from("docs").select("data").eq("home", home).eq("path", path).limit(1).then(function (res) {
      if (res.error) throw res.error;
      return res.data && res.data[0] ? res.data[0].data : null;
    });
  }
  function writeDoc(home, path, data) {
    return sb.from("docs").upsert({ home: home, path: path, data: data, updated_at: new Date().toISOString() }).then(function (res) {
      if (res.error) throw res.error;
    });
  }
  /* Live updates, plus a light poll in case the live feed is slow to connect. */
  function watchDoc(home, path, fn) {
    var ch = sb.channel(home + "-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "home=eq." + home }, function (p) {
        if (p["new"] && p["new"].data && p["new"].path === path) fn(p["new"].data);
      }).subscribe();
    var timer = setInterval(function () { readDoc(home, path).then(function (d) { if (d) fn(d); }).catch(function () {}); }, 2000);
    return function () { clearInterval(timer); try { sb.removeChannel(ch); } catch (e) {} };
  }
  function readSession(code) { return readDoc(room(code), "session"); }
  function writeSession(code, data) { return writeDoc(room(code), "session", data); }
  function watchSession(code, fn) { return watchDoc(room(code), "session", fn); }

  /* ---------- The home this device belongs to (kept on the device) ---------- */
  var H = window.HomieDash;
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };
  var homeId = store.get("homie-home");
  var dashKey = function (id) { return "home-" + id; };

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
      if (!homeId) { homeId = randomDigits(10); store.set("homie-home", homeId); }
      writeSession(code, { status: "waiting", createdAt: Date.now(), home: homeId }).then(function () {
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
            store.set("homie-paired", "1");
            setTimeout(openDash, 2600);
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

    /* ---- Dashboard: drawn from the shared doc, never touched on the iPad ---- */
    var dash = { stop: null, data: null, clock: 0 };
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    var tickClock = function () {
      var d = new Date();
      $("dashTime").textContent = two(d.getHours()) + ":" + two(d.getMinutes());
      $("dashDate").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    };
    var tileHtml = function (dev) {
      var c = H.byType[dev.type];
      return '<div class="tile-top"><span class="tile-icon">' + H.icon(dev.type, 24) + '</span><span class="tile-dot"></span></div>' +
        '<div><div class="tile-name"></div><div class="tile-room"></div><div class="tile-status"></div></div>';
    };
    var fillTile = function (el, dev) {
      var c = H.byType[dev.type];
      el.className = "tile size-" + (dev.size || "s") + (H.isActive(dev) ? " on" : "") + (c.caps.indexOf("temp") >= 0 || dev.type === "sensor" ? " big-value" : "");
      el.querySelector(".tile-name").textContent = dev.name;
      el.querySelector(".tile-room").textContent = dev.room;
      el.querySelector(".tile-status").textContent = H.status(dev);
    };
    var renderDash = function (data) {
      data = H.normalise(data);
      dash.data = data;
      H.applyTheme(document.documentElement, data.theme);
      $("dash").classList.toggle("no-clock", data.theme.clock === false);
      $("dashName").textContent = data.name;
      var n = data.devices.length;
      $("dashCount").textContent = n === 0 ? "No devices yet" : n === 1 ? "1 device" : n + " devices";
      $("dashEmpty").hidden = n > 0;
      var grid = $("dashGrid");
      var cells = 0; data.devices.forEach(function (d) { cells += d.size === "l" ? 4 : d.size === "w" ? 2 : 1; });
      grid.classList.toggle("dense", cells > 12);
      H.renderKeyed(grid, data.devices, function (d) { return d.id; }, function (d) {
        var el = document.createElement("div"); el.innerHTML = tileHtml(d); fillTile(el, d); return el;
      }, fillTile);
    };
    var openDash = function () {
      stopPairing();
      if (dash.stop) dash.stop();
      $("dashEmptyIcon").innerHTML = H.icon("phone", 40);
      tickClock(); clearInterval(dash.clock); dash.clock = setInterval(tickClock, 15000);
      renderDash(null);
      show("dash");
      readDoc(dashKey(homeId), "dashboard").then(function (d) { if (d && !d.unpaired && dash.data && (d.updatedAt || 0) >= (dash.data.updatedAt || 0)) renderDash(d); }).catch(function () {});
      dash.stop = watchDoc(dashKey(homeId), "dashboard", function (d) {
        if (d && d.unpaired) { leaveDash(); return; }
        if (!dash.data || (d.updatedAt || 0) >= (dash.data.updatedAt || 0)) renderDash(d);
      });
    };
    var leaveDash = function () {
      if (dash.stop) dash.stop(); dash.stop = null;
      store.del("homie-paired"); store.del("homie-home"); homeId = null;
      H.applyTheme(document.documentElement, H.fresh().theme);
      show("start");
    };

    $("getStarted").addEventListener("click", startPairing);
    $("signIn").addEventListener("click", function () { toast("Sign in is coming soon. Tap Get started to pair."); });
    $("manualToggle").addEventListener("click", function () { setManual(!manualOn); });
    $("pairedDone").addEventListener("click", openDash);
    $("errorRetry").addEventListener("click", startPairing);
    if (homeId && store.get("homie-paired") && sb) openDash(); else show("start");
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
        P.home = s.home || null;
        return writeSession(code, { status: "joined", createdAt: s.createdAt, home: s.home, confirm: confirm, phone: deviceName(), joinedAt: Date.now() }).then(function () {
          $("confirmCode").textContent = confirm.slice(0, 3) + " - " + confirm.slice(3);
          P.confirm = confirm;
          show("confirm");
        });
      }).catch(function () { fail("Homie can't connect right now.", "Check your phone is online and try again"); });
    };

    $("confirmYes").addEventListener("click", function () {
      var btn = this; btn.disabled = true;
      writeSession(P.code, { status: "paired", home: P.home, confirm: P.confirm, phone: deviceName(), pairedAt: Date.now() }).then(function () {
        if (P.home) { homeId = P.home; store.set("homie-home", homeId); }
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
    $("pairedOpen").addEventListener("click", function () { openHome(); });
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

    /* ---- Dashboard editor ---- */
    var E = { data: null, stop: null, editing: null, arranging: false, saveT: 0 };
    var save = function () {
      E.data.updatedAt = Date.now();
      renderList();
      clearTimeout(E.saveT);
      E.saveT = setTimeout(function () {
        writeDoc(dashKey(homeId), "dashboard", E.data).catch(function () { toast("Couldn't reach the display. Check you're online."); });
      }, 120);
    };
    var devById = function (id) { for (var i = 0; i < E.data.devices.length; i++) if (E.data.devices[i].id === id) return E.data.devices[i]; return null; };
    var devHtml = function (dev) {
      return '<span class="tile-icon">' + H.icon(dev.type, 22) + '</span><span class="dev-text"><span class="dev-name"></span><span class="dev-sub"></span></span>' +
        '<button class="switch" role="switch" aria-checked="false" aria-label="Power"><i></i></button>' +
        '<span class="move"><button data-move="-1" aria-label="Move up">↑</button><button data-move="1" aria-label="Move down">↓</button></span>';
    };
    var fillDev = function (el, dev, idx) {
      var c = H.byType[dev.type];
      el.className = "dev" + (H.isActive(dev) ? " on" : "");
      el.querySelector(".dev-name").textContent = dev.name;
      el.querySelector(".dev-sub").textContent = dev.room + "  ·  " + H.status(dev);
      var sw = el.querySelector(".switch");
      sw.hidden = c.caps.indexOf("on") < 0;
      sw.setAttribute("aria-checked", dev.on ? "true" : "false");
      el.querySelector('[data-move="-1"]').disabled = idx === 0;
      el.querySelector('[data-move="1"]').disabled = idx === E.data.devices.length - 1;
    };
    var renderList = function () {
      var list = $("deviceList");
      $("homeName").textContent = E.data.name;
      $("listEmpty").hidden = E.data.devices.length > 0;
      $("arrangeToggle").hidden = E.data.devices.length < 2;
      if (E.data.devices.length < 2) { E.arranging = false; }
      list.classList.toggle("arranging", E.arranging);
      $("arrangeToggle").classList.toggle("on", E.arranging);
      $("arrangeToggle").textContent = E.arranging ? "Finished" : "Arrange";
      H.renderKeyed(list, E.data.devices, function (d) { return d.id; }, function (d, i) {
        var el = document.createElement("div"); el.innerHTML = devHtml(d); fillDev(el, d, i);
        el.addEventListener("click", function (e) {
          var t = e.target.closest("button");
          var dev = devById(el.getAttribute("data-key")); if (!dev) return;
          if (t && t.classList.contains("switch")) { dev.on = !dev.on; save(); return; }
          if (t && t.hasAttribute("data-move")) { var from = E.data.devices.indexOf(dev), to = from + (+t.getAttribute("data-move")); if (to < 0 || to >= E.data.devices.length) return; E.data.devices.splice(from, 1); E.data.devices.splice(to, 0, dev); save(); return; }
          if (!E.arranging) openEdit(dev.id);
        });
        return el;
      }, fillDev);
      H.applyTheme(document.documentElement, Object.assign({}, E.data.theme, { mode: "light", corners: "round" }));
    };
    var openHome = function () {
      stopCamera();
      if (!homeId) { goScan(); return; }
      if (!E.data) E.data = H.fresh();
      renderList();
      show("home");
      if (E.stop) return;
      E.stop = watchDoc(dashKey(homeId), "dashboard", function (d) {
        if (!d || d.unpaired) return;
        if ((d.updatedAt || 0) > (E.data.updatedAt || 0)) { E.data = H.normalise(d); renderList(); if (E.editing) fillEdit(); }
      });
      readDoc(dashKey(homeId), "dashboard").then(function (d) { if (d && !d.unpaired && (d.updatedAt || 0) > (E.data.updatedAt || 0)) { E.data = H.normalise(d); renderList(); } }).catch(function () {});
    };

    /* Add */
    var cat = $("catalogue");
    H.CATALOGUE.forEach(function (c) {
      var b = document.createElement("button"); b.className = "cat"; b.setAttribute("data-type", c.type);
      b.innerHTML = '<span class="tile-icon">' + H.icon(c.type, 22) + '</span><span><span class="cat-name">' + H.escape(c.name) + '</span><br><span class="cat-kind">' + H.escape(c.kind) + "</span></span>";
      b.addEventListener("click", function () {
        var dev = H.newDevice(c.type);
        E.data.devices.push(dev); save();
        if (navigator.vibrate) navigator.vibrate(20);
        toast(c.name + " added to the display");
        openEdit(dev.id);
      });
      cat.appendChild(b);
    });
    $("addDevice").addEventListener("click", function () { show("add"); });
    $("addBack").addEventListener("click", function () { show("home"); });

    /* Edit one device */
    var LEVEL_LABEL = { speaker: "Volume", blinds: "Open" };
    var fillEdit = function () {
      var dev = devById(E.editing); if (!dev) { show("home"); return; }
      var c = H.byType[dev.type];
      $("editTitle").textContent = dev.name; $("editKind").textContent = c.name + "  ·  changes show on the display as you make them";
      if (document.activeElement !== $("editName")) $("editName").value = dev.name;
      if (document.activeElement !== $("editRoom")) $("editRoom").value = dev.room;
      segSet($("editSize"), dev.size || "s");
      $("editOnRow").hidden = c.caps.indexOf("on") < 0; $("editOn").setAttribute("aria-checked", dev.on ? "true" : "false");
      $("editLevelRow").hidden = c.caps.indexOf("level") < 0; $("editLevel").value = dev.level || 0; $("editLevelVal").textContent = (dev.level || 0) + "%"; $("editLevelLabel").textContent = LEVEL_LABEL[dev.type] || "Brightness";
      $("editTempRow").hidden = c.caps.indexOf("temp") < 0; $("editTemp").textContent = dev.temp + "°";
    };
    var openEdit = function (id) { E.editing = id; fillEdit(); show("edit"); };
    var segSet = function (seg, v) { var bs = seg.querySelectorAll("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-v") === v); };
    var segOn = function (seg, fn) { seg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; segSet(seg, b.getAttribute("data-v")); fn(b.getAttribute("data-v")); }); };
    var edited = function (fn) { return function () { var dev = devById(E.editing); if (!dev) return; fn(dev, this); save(); fillEdit(); }; };
    $("editName").addEventListener("input", edited(function (dev, el) { dev.name = el.value.trim() || H.byType[dev.type].defaults.name; }));
    $("editRoom").addEventListener("input", edited(function (dev, el) { dev.room = el.value.trim() || "Home"; }));
    segOn($("editSize"), function (v) { edited(function (dev) { dev.size = v; }).call(null); });
    $("editOn").addEventListener("click", edited(function (dev) { dev.on = !dev.on; }));
    $("editLevel").addEventListener("input", edited(function (dev, el) { dev.level = +el.value; if (dev.type !== "blinds" && dev.level > 0) dev.on = true; }));
    $("tempDown").addEventListener("click", edited(function (dev) { dev.temp = Math.max(10, Math.round((dev.temp - 0.5) * 2) / 2); }));
    $("tempUp").addEventListener("click", edited(function (dev) { dev.temp = Math.min(30, Math.round((dev.temp + 0.5) * 2) / 2); }));
    $("editRemove").addEventListener("click", function () {
      var dev = devById(E.editing); if (!dev) return;
      E.data.devices.splice(E.data.devices.indexOf(dev), 1); E.editing = null; save(); show("home");
    });
    $("editDone").addEventListener("click", function () { E.editing = null; show("home"); });
    $("arrangeToggle").addEventListener("click", function () { E.arranging = !E.arranging; renderList(); });

    /* Customise the display */
    var sw = $("custAccent");
    Object.keys(H.ACCENTS).forEach(function (k) {
      var b = document.createElement("button"); b.className = "swatch"; b.style.background = H.ACCENTS[k]; b.setAttribute("data-v", k); b.setAttribute("aria-label", k);
      b.addEventListener("click", function () { E.data.theme.accent = k; save(); fillCustomise(); });
      sw.appendChild(b);
    });
    var fillCustomise = function () {
      var t = E.data.theme;
      if (document.activeElement !== $("custName")) $("custName").value = E.data.name;
      segSet($("custMode"), t.mode); segSet($("custCorners"), t.corners);
      var ss = sw.querySelectorAll(".swatch"); for (var i = 0; i < ss.length; i++) ss[i].classList.toggle("on", ss[i].getAttribute("data-v") === t.accent);
      $("custClock").setAttribute("aria-checked", t.clock !== false ? "true" : "false");
    };
    $("openCustomise").addEventListener("click", function () { fillCustomise(); show("customise"); });
    $("customiseDone").addEventListener("click", function () { show("home"); });
    $("custName").addEventListener("input", function () { E.data.name = this.value.trim() || "Home"; save(); });
    segOn($("custMode"), function (v) { E.data.theme.mode = v; save(); });
    segOn($("custCorners"), function (v) { E.data.theme.corners = v; save(); });
    $("custClock").addEventListener("click", function () { E.data.theme.clock = E.data.theme.clock === false; save(); fillCustomise(); });
    $("unpair").addEventListener("click", function () {
      if (!window.confirm("Unpair this display? It will go back to its start screen.")) return;
      writeDoc(dashKey(homeId), "dashboard", { unpaired: true, updatedAt: Date.now() }).catch(function () {});
      if (E.stop) E.stop(); E.stop = null; E.data = null;
      store.del("homie-home"); homeId = null;
      H.applyTheme(document.documentElement, H.fresh().theme);
      goScan();
    });

    var start = /^#pair-(\d{6})$/.exec(location.hash);
    if (start) join(start[1]); else if (homeId && sb) openHome(); else { show("scan"); startCamera(); }

    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
