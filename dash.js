/* Homie dashboard: the things both screens share.
   A home's dashboard is one Supabase row: docs(home = "home-<id>", path = "dashboard").
   Its data is { name, theme: {mode, accent, corners, clock}, devices: [...] }.
   The phone edits that row; the display only reads it and redraws. */
window.HomieDash = (function () {
  "use strict";

  /* Device catalogue. "caps" lists which controls a device has: on, level (0-100), temp (°C). */
  var CATALOGUE = [
    { type: "hue", name: "Philips Hue", kind: "Light", caps: ["on", "level"], defaults: { name: "Hue lamp", room: "Living room", on: true, level: 80 } },
    { type: "light", name: "Smart light", kind: "Light", caps: ["on", "level"], defaults: { name: "Ceiling light", room: "Kitchen", on: false, level: 100 } },
    { type: "aircon", name: "Air conditioner", kind: "Climate", caps: ["on", "temp"], defaults: { name: "Air con", room: "Bedroom", on: true, temp: 21 } },
    { type: "thermostat", name: "Thermostat", kind: "Climate", caps: ["on", "temp"], defaults: { name: "Heating", room: "Hallway", on: true, temp: 20 } },
    { type: "plug", name: "Smart plug", kind: "Power", caps: ["on"], defaults: { name: "Lamp plug", room: "Living room", on: true } },
    { type: "speaker", name: "Speaker", kind: "Media", caps: ["on", "level"], defaults: { name: "Speaker", room: "Living room", on: false, level: 40 } },
    { type: "tv", name: "TV", kind: "Media", caps: ["on"], defaults: { name: "TV", room: "Living room", on: false } },
    { type: "blinds", name: "Blinds", kind: "Covers", caps: ["level"], defaults: { name: "Blinds", room: "Bedroom", level: 60 } },
    { type: "sensor", name: "Climate sensor", kind: "Sensor", caps: [], defaults: { name: "Sensor", room: "Nursery", temp: 21.5, humidity: 48 } },
    { type: "robot", name: "Robot vacuum", kind: "Cleaning", caps: ["on"], defaults: { name: "Vacuum", room: "Downstairs", on: false } }
  ];
  var byType = {};
  CATALOGUE.forEach(function (c) { byType[c.type] = c; });

  /* Simple line icons, 24 x 24, drawn with the current colour. */
  var P = function (d) { return '<path d="' + d + '"/>'; };
  var ICONS = {
    hue: P("M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1.9 1.8V17h5.2v-1.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z") + P("M10 20h4"),
    light: P("M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1.9 1.8V17h5.2v-1.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z") + P("M10 20h4"),
    aircon: P("M3 6h18v7H3z") + P("M7 13v3M12 13v5M17 13v3") + P("M7 9.5h10"),
    thermostat: P("M12 14.5V5a2 2 0 1 0-4 0v9.5a3.5 3.5 0 1 0 4 0z").replace("M12", "M14").replace("a2 2 0 1 0-4 0", "a2 2 0 1 0-4 0") + P("M17 7h3M17 11h3"),
    plug: P("M9 3v5M15 3v5") + P("M6 8h12v3a6 6 0 0 1-12 0z") + P("M12 17v4"),
    speaker: P("M6 3h12v18H6z") + P("M12 15.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z") + P("M12 7.5h.01"),
    tv: P("M3 5h18v12H3z") + P("M8 21h8"),
    blinds: P("M3 4h18") + P("M5 4v16h14V4") + P("M5 9h14M5 14h14"),
    sensor: P("M12 21a7 7 0 0 0 4.5-12.4L12 4l-4.5 4.6A7 7 0 0 0 12 21z"),
    robot: P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z") + P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z") + P("M12 3v3"),
    plus: P("M12 5v14M5 12h14"),
    phone: P("M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z") + P("M10.5 18h3")
  };
  ICONS.thermostat = P("M14 14.5V5a2 2 0 1 0-4 0v9.5a3.5 3.5 0 1 0 4 0z") + P("M17 7h3M17 11h3");
  function icon(name, size) {
    return '<svg class="ic" viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.plug) + "</svg>";
  }

  var ACCENTS = { blue: "#1e8bff", green: "#1db954", orange: "#ff7a1a", pink: "#ff3d8e", purple: "#8b5cf6", mono: "#2f2f2f" };

  function fresh() {
    return { name: "Home", theme: { mode: "light", accent: "blue", corners: "round", clock: true }, devices: [], updatedAt: 0 };
  }
  function normalise(d) {
    var f = fresh();
    if (!d || typeof d !== "object") return f;
    d.name = d.name || f.name;
    d.theme = Object.assign(f.theme, d.theme || {});
    d.devices = Array.isArray(d.devices) ? d.devices.filter(function (x) { return x && byType[x.type]; }) : [];
    return d;
  }
  function newDevice(type) {
    var c = byType[type];
    var dev = Object.assign({ id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: type, size: "s" }, c.defaults);
    return dev;
  }

  /* One line describing the device's current state, used on both screens. */
  function status(dev) {
    var c = byType[dev.type], has = function (k) { return c.caps.indexOf(k) >= 0; };
    if (dev.type === "sensor") return (dev.temp != null ? dev.temp + "°" : "") + (dev.humidity != null ? "  ·  " + dev.humidity + "%" : "");
    if (has("on") && !dev.on) return "Off";
    if (has("temp")) return dev.temp + "°";
    if (dev.type === "blinds") return dev.level + "% open";
    if (has("level")) return "On  ·  " + dev.level + "%";
    return "On";
  }
  function isActive(dev) {
    var c = byType[dev.type];
    if (c.caps.indexOf("on") >= 0) return !!dev.on;
    if (dev.type === "blinds") return dev.level > 0;
    return false;
  }
  function escape(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  /* Keyed render with a FLIP move: existing elements slide to their new place instead of jumping. */
  function renderKeyed(container, items, keyOf, make, update) {
    var old = {}, i, el;
    for (i = 0; i < container.children.length; i++) { el = container.children[i]; old[el.getAttribute("data-key")] = { el: el, rect: el.getBoundingClientRect() }; }
    var keep = {};
    items.forEach(function (item, idx) {
      var key = keyOf(item), entry = old[key];
      if (entry) { el = entry.el; update(el, item, idx); }
      else { el = make(item, idx); el.setAttribute("data-key", key); el.classList.add("is-new"); }
      keep[key] = true;
      if (container.children[idx] !== el) container.insertBefore(el, container.children[idx] || null);
    });
    Object.keys(old).forEach(function (k) { if (!keep[k]) { var x = old[k].el; x.classList.add("is-gone"); setTimeout(function () { if (x.parentNode) x.parentNode.removeChild(x); }, 220); } });
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    Object.keys(keep).forEach(function (k) {
      var entry = old[k]; if (!entry) return;
      var now = entry.el.getBoundingClientRect();
      var dx = entry.rect.left - now.left, dy = entry.rect.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      var e = entry.el;
      e.style.transition = "none"; e.style.transform = "translate(" + dx + "px," + dy + "px)";
      requestAnimationFrame(function () { e.style.transition = "transform .5s cubic-bezier(.2,.8,.2,1)"; e.style.transform = ""; });
    });
    setTimeout(function () { var n = container.querySelectorAll(".is-new"); for (var j = 0; j < n.length; j++) n[j].classList.remove("is-new"); }, 700);
  }

  function applyTheme(root, theme) {
    root.setAttribute("data-theme", theme.mode === "dark" ? "dark" : "light");
    root.setAttribute("data-corners", theme.corners || "round");
    root.style.setProperty("--accent", ACCENTS[theme.accent] || ACCENTS.blue);
    root.style.setProperty("--accent-rgb", hexRgb(ACCENTS[theme.accent] || ACCENTS.blue));
  }
  function hexRgb(h) { return parseInt(h.slice(1, 3), 16) + "," + parseInt(h.slice(3, 5), 16) + "," + parseInt(h.slice(5, 7), 16); }

  return { CATALOGUE: CATALOGUE, byType: byType, ACCENTS: ACCENTS, icon: icon, fresh: fresh, normalise: normalise, newDevice: newDevice, status: status, isActive: isActive, escape: escape, renderKeyed: renderKeyed, applyTheme: applyTheme };
})();
