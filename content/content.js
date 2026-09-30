/*!
 * AutoBlur v1.0.0
 * Copyright (c) 2026 Jaewon Lee (huyckkid14)
 * Email: bestorangelover@gmail.com
 *
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */


(() => {
  const EXT = "autoblur";
  const Z = 2147483647; // max-ish
  const STATE = {
    sidebarOpen: true,
    tool: "rect", // rect | text | remove
    radiusPx: 12,
    drawing: false,
    startClient: null,
    dragging: null, // { el, startX, startY, startLeft, startTop, startScrollX, startScrollY }
    currentSelectionInfo: null
  };

  /* ---------- Utilities ---------- */

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function $(sel, root=document){
    return root.querySelector(sel);
  }

  function createEl(tag, attrs={}){
    const el = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k === "style") Object.assign(el.style, v);
      else if(k === "class") el.className = v;
      else if(k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    return el;
  }

  function isEditableTarget(t){
    if(!t) return false;
    const tag = (t.tagName || "").toLowerCase();
    if(tag === "textarea") return true;
    if(tag === "input"){
      const type = (t.getAttribute("type") || "").toLowerCase();
      return !type || ["text","search","email","url","tel","password","number"].includes(type);
    }
    if(t.isContentEditable) return true;
    return false;
  }

  function setRootRadius(px){
    STATE.radiusPx = clamp(px, 0, 60);
    document.documentElement.style.setProperty("--ab-radius", `${STATE.radiusPx}px`);
    // Update all existing blocks/spans (in case some browser doesn't re-evaluate var)
    document.querySelectorAll(".ab-blur-block").forEach(el => {
      el.style.backdropFilter = `blur(${STATE.radiusPx}px)`;
      el.style.webkitBackdropFilter = `blur(${STATE.radiusPx}px)`;
    });
    document.querySelectorAll(".ab-text-blur").forEach(el => {
      el.style.filter = `blur(${STATE.radiusPx}px)`;
    });
    ui?.updateRadiusDisplay();
  }

  function toast(msg){
    if(!ui) return;
    ui.toast(msg);
  }

  /* ---------- Global CSS for blur elements ---------- */

  function ensureGlobalStyle(){
    if(document.getElementById("ab-global-style")) return;
    const style = createEl("style", { id: "ab-global-style" });
    style.textContent = `
      :root{ --ab-radius: ${STATE.radiusPx}px; }
      .ab-blur-block{
        position:absolute;
        border-radius: 10px;
        backdrop-filter: blur(var(--ab-radius));
        -webkit-backdrop-filter: blur(var(--ab-radius));
        background: rgba(255,255,255,0.04);
        outline: 1px solid rgba(255,255,255,0.16);
        box-shadow:
          0 10px 30px rgba(0,0,0,0.18),
          inset 0 1px 0 rgba(255,255,255,0.22);
        z-index: ${Z - 10};
        pointer-events: auto;
        cursor: grab;
        user-select: none;
      }
      .ab-blur-block.ab-dragging{
        cursor: grabbing;
        outline: 2px solid rgba(140,90,255,0.85);
        box-shadow:
          0 18px 45px rgba(0,0,0,0.28),
          inset 0 1px 0 rgba(255,255,255,0.22);
      }
      html.ab-remove-mode .ab-blur-block{ cursor: pointer; }
      .ab-text-blur{
        display:inline;
        filter: blur(var(--ab-radius));
        will-change: filter;
        pointer-events: auto;
      }
      .ab-remove-hover{
        outline: 2px dashed rgba(255, 64, 64, 0.9) !important;
        outline-offset: 2px;
      }
      /* Drawing overlay */
      #ab-draw-overlay{
        position: fixed;
        inset: 0;
        z-index: ${Z - 5};
        display: none;
        cursor: crosshair;
        background: rgba(0,0,0,0.00);
      }
      #ab-draw-box{
        position: absolute;
        border-radius: 12px;
        border: 2px solid rgba(255,255,255,0.85);
        background: rgba(255,255,255,0.10);
        box-shadow: 0 12px 35px rgba(0,0,0,0.25);
        display:none;
      }
    `;
    document.documentElement.appendChild(style);
  }

  /* ---------- Sidebar UI (Shadow DOM) ---------- */

  let ui = null;

  function mountUI(){
    if(ui) return ui;

    ensureGlobalStyle();
    setRootRadius(STATE.radiusPx);

    // Host + shadow
    const host = createEl("div", {
      id: "ab-sidebar-host",
      style: {
        position: "fixed",
        top: "0px",
        right: "0px",
        height: "100vh",
        width: "360px",
        zIndex: String(Z),
        pointerEvents: "auto"
      }
    });
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    const style = createEl("style");
    style.textContent = `
      :host{ all: initial; }
      *{ box-sizing: border-box; }
      .panel{
        height: 100%;
        width: 360px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 14px 16px 14px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        color: rgba(255,255,255,0.96);
        background:
          radial-gradient(1200px 500px at 70% 20%, rgba(140, 90, 255, 0.28), rgba(0,0,0,0) 60%),
          radial-gradient(900px 500px at 20% 60%, rgba(40, 240, 200, 0.18), rgba(0,0,0,0) 65%),
          linear-gradient(180deg, rgba(12,12,18,0.92), rgba(8,8,12,0.86));
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border-left: 1px solid rgba(255,255,255,0.12);
        box-shadow: -20px 0 60px rgba(0,0,0,0.35);
      }
      .top{
        display:flex;
        align-items:center;
        justify-content: space-between;
        gap: 10px;
      }
      .brand{
        display:flex;
        align-items:center;
        gap: 10px;
      }
      .logo{
        width: 36px; height: 36px;
        border-radius: 12px;
        background:
          radial-gradient(12px 12px at 30% 30%, rgba(255,255,255,0.9), rgba(255,255,255,0) 60%),
          linear-gradient(135deg, rgba(255,120,90,1), rgba(140,90,255,1));
        box-shadow: 0 10px 25px rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.2);
      }
      .title{
        display:flex; flex-direction:column; line-height: 1.15;
      }
      .title b{ font-size: 14px; letter-spacing: 0.4px; }
      .title span{ font-size: 12px; opacity: 0.75; }
      .iconBtn{
        all: unset;
        cursor: pointer;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width: 34px; height: 34px;
        border-radius: 12px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        transition: transform .12s ease, background .12s ease, border-color .12s ease;
      }
      .iconBtn:hover{ transform: translateY(-1px); background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.18); }
      .iconBtn:active{ transform: translateY(0px) scale(0.98); }
      .section{
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px;
        padding: 12px;
        box-shadow:
          0 12px 30px rgba(0,0,0,0.20),
          inset 0 1px 0 rgba(255,255,255,0.10);
      }
      .section h3{
        margin: 0 0 10px 0;
        font-size: 12px;
        letter-spacing: 0.35px;
        opacity: 0.85;
        text-transform: uppercase;
      }
      .tools{
        display:grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .tool{
        all: unset;
        cursor:pointer;
        padding: 10px 10px;
        border-radius: 14px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.10);
        display:flex;
        flex-direction: column;
        gap: 6px;
        min-height: 78px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        transition: transform .12s ease, background .12s ease, border-color .12s ease;
      }
      .tool:hover{ transform: translateY(-1px); background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.20); }
      .tool:active{ transform: translateY(0px) scale(0.99); }
      .tool.active{
        background: rgba(140,90,255,0.22);
        border-color: rgba(140,90,255,0.55);
      }
      .tool .name{ font-size: 12px; font-weight: 800; }
      .tool .desc{ font-size: 11px; opacity: 0.75; line-height: 1.25; }
      .row{
        display:flex;
        align-items:center;
        justify-content: space-between;
        gap: 12px;
      }
      .radiusVal{
        font-size: 12px;
        opacity: 0.88;
      }
      input[type="range"]{
        width: 100%;
        accent-color: rgb(140,90,255);
      }
      .btn{
        all: unset;
        cursor:pointer;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255,255,255,0.10);
        border: 1px solid rgba(255,255,255,0.12);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.2px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap: 8px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        transition: transform .12s ease, background .12s ease, border-color .12s ease;
      }
      .btn:hover{ transform: translateY(-1px); background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.20); }
      .btn:active{ transform: translateY(0px) scale(0.99); }
      .btn.danger{
        background: rgba(255, 70, 70, 0.14);
        border-color: rgba(255, 90, 90, 0.35);
      }
      .hint{
        font-size: 11px;
        line-height: 1.35;
        opacity: 0.75;
      }
      .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;

        z-index: 999999999;

        padding: 14px 18px;
        border-radius: 14px;

        background: #11121a;
        color: #ffffff;

        border: 1px solid rgba(255, 255, 255, 0.25);

        font-size: 13px;
        font-weight: 700;

        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);

        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;

        transition: opacity 0.16s ease, transform 0.16s ease;
      }

      .toast.show {
        opacity: 1;
        transform: translateY(0);
      }

      .kbd{
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.08);
        opacity: 0.9;
      }
      .footer{
        margin-top:auto;
        display:flex;
        align-items:center;
        justify-content: space-between;
        gap: 10px;
        opacity: 0.75;
        font-size: 11px;
      }
      .tinyLink{
        all: unset;
        cursor:pointer;
        text-decoration: underline;
        opacity: 0.85;
      }
    `;

    const panel = createEl("div", { class: "panel" });

    // Header
    const top = createEl("div", { class: "top" });
    const brand = createEl("div", { class: "brand" });
    const logo = createEl("div", { class: "logo", title: "AutoBlur" });
    const title = createEl("div", { class: "title" });
    title.innerHTML = `<b>AutoBlur</b><span>Blur anything — fast.</span>`;
    brand.appendChild(logo);
    brand.appendChild(title);

    const closeBtn = createEl("button", { class: "iconBtn", title: "Close sidebar (click extension icon to reopen)" });
    closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M18 6L6 18" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M6 6L18 18" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    closeBtn.addEventListener("click", () => setSidebarOpen(false));

    top.appendChild(brand);
    top.appendChild(closeBtn);

    // Tools section
    const toolSection = createEl("div", { class: "section" });
    toolSection.innerHTML = `<h3>Tools</h3>`;
    const tools = createEl("div", { class: "tools" });

    const toolButtons = {
      rect: makeToolButton("Rectangle Blur", "Drag to blur. Drag a blur to move it."),
      text: makeToolButton("Text Blur", "Select text to blur it."),
      remove: makeToolButton("Remove", "Click blur to delete.")
    };

    for(const [k,btn] of Object.entries(toolButtons)){
      btn.addEventListener("click", () => setTool(k));
      tools.appendChild(btn);
    }

    toolSection.appendChild(tools);

    const hint = createEl("div", { class: "hint" });
    hint.innerHTML = `
      • Rectangle Blur: click-drag on the page.<br>
      • Move: drag an existing blur box anywhere (<span class="kbd">Esc</span> cancels).<br>
      • Text Blur: highlight text, then release mouse.<br>
      • Remove: hover/click a blur to remove it.<br><br>
      Shortcut: <span class="kbd">Alt</span> + <span class="kbd">B</span>
    `;
    toolSection.appendChild(hint);

    // Radius section
    const radiusSection = createEl("div", { class: "section" });
    radiusSection.innerHTML = `<h3>Blur radius</h3>`;
    const row = createEl("div", { class: "row" });
    const radiusVal = createEl("div", { class: "radiusVal" });
    const slider = createEl("input", { type: "range", min: "0", max: "60", value: String(STATE.radiusPx) });
    slider.addEventListener("input", () => setRootRadius(Number(slider.value)));
    row.appendChild(createEl("div", { style: { fontSize: "12px", opacity: "0.85" } }));
    row.appendChild(radiusVal);

    const resetRow = createEl("div", { class: "row", style: { marginTop: "10px" } });
    const clearBtn = createEl("button", { class: "btn danger" });
    clearBtn.textContent = "Clear all blurs";
    clearBtn.addEventListener("click", clearAllBlurs);

    const resetBtn = createEl("button", { class: "btn" });
    resetBtn.textContent = "Reset radius";
    resetBtn.addEventListener("click", () => {
      slider.value = "12";
      setRootRadius(12);
      toast("Radius reset.");
    });

    resetRow.appendChild(resetBtn);
    resetRow.appendChild(clearBtn);

    radiusSection.appendChild(row);
    radiusSection.appendChild(slider);
    radiusSection.appendChild(resetRow);

    // Footer
    const footer = createEl("div", { class: "footer" });
    const status = createEl("div");
    status.innerHTML = `Status: <span id="ab-status">ready</span>`;
    const help = createEl("button", { class: "tinyLink" });
    help.textContent = "Tips";
    help.addEventListener("click", () => {
      toast("Tip: If text blur fails on complex selections, try selecting a smaller chunk of text.");
    });

    footer.appendChild(status);
    footer.appendChild(help);

    // Toast
    const toastEl = createEl("div", { class: "toast", id: "ab-toast" });

    panel.appendChild(top);
    panel.appendChild(toolSection);
    panel.appendChild(radiusSection);
    panel.appendChild(footer);

    shadow.appendChild(style);
    shadow.appendChild(panel);
    shadow.appendChild(toastEl);

    function makeToolButton(name, desc){
      const btn = createEl("button", { class: "tool" });
      btn.innerHTML = `<div class="name">${name}</div><div class="desc">${desc}</div>`;
      return btn;
    }

    function updateActiveTool(){
      for(const [k,btn] of Object.entries(toolButtons)){
        btn.classList.toggle("active", STATE.tool === k);
      }
      const st = $("#ab-status", shadow) || shadow.getElementById?.("ab-status");
      const statusEl = shadow.querySelector("#ab-status");
      if(statusEl) statusEl.textContent = STATE.tool;
    }

    function updateRadiusDisplay(){
      radiusVal.textContent = `${STATE.radiusPx}px`;
    }

    let toastTimer = null;
    function showToast(text){
      toastEl.textContent = text;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
    }

    function setSidebarOpen(open){
      STATE.sidebarOpen = open;
      host.style.display = open ? "block" : "none";
      // When closing, disable tools to prevent surprise captures
      if(!open) disableDrawingOverlay();
    }

    function clearAllBlurs(){
      document.querySelectorAll(".ab-blur-block, .ab-text-blur").forEach(el => el.remove());
      toast("Cleared all blurs.");
    }

    // Init
    updateRadiusDisplay();
    updateActiveTool();

    ui = {
      host,
      shadow,
      setSidebarOpen,
      updateActiveTool,
      updateRadiusDisplay,
      toast: showToast,
      slider
    };

    return ui;
  }

  function setSidebarOpen(open){
    mountUI().setSidebarOpen(open);
  }

  function setTool(tool){
    STATE.tool = tool;
    document.documentElement.classList.toggle("ab-remove-mode", tool === "remove");
    mountUI().updateActiveTool();
    if(tool === "rect"){
      enableDrawingOverlay();
      toast("Rectangle Blur: drag on the page.");
    }else{
      disableDrawingOverlay();
      if(tool === "text"){
        toast("Text Blur: highlight text and release mouse.");
      }else if(tool === "remove"){
        toast("Remove: click a blur to delete.");
      }
    }
  }

  /* ---------- Rectangle drawing overlay ---------- */

  let overlay = null;
  let box = null;

  function ensureOverlay(){
    if(overlay) return;
    overlay = createEl("div", { id: "ab-draw-overlay" });
    box = createEl("div", { id: "ab-draw-box" });
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener("mousedown", (e) => {
      if(STATE.tool !== "rect") return;
      if(e.button !== 0) return;
      if(isEditableTarget(e.target)) return;

      // Pressing on an existing blur moves it instead of drawing a new one
      const hit = blurBlockAt(e.clientX, e.clientY);
      if(hit){
        startDrag(hit, e);
        return;
      }

      STATE.drawing = true;
      STATE.startClient = { x: e.clientX, y: e.clientY };
      box.style.display = "block";
      box.style.left = `${e.clientX}px`;
      box.style.top = `${e.clientY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      e.preventDefault();
    });

    overlay.addEventListener("mousemove", (e) => {
      if(!STATE.drawing){
        if(!STATE.dragging) overlay.style.cursor = blurBlockAt(e.clientX, e.clientY) ? "grab" : "";
        return;
      }
      const x0 = STATE.startClient.x;
      const y0 = STATE.startClient.y;
      const x1 = e.clientX;
      const y1 = e.clientY;

      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);

      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    });

    overlay.addEventListener("mouseup", (e) => {
      if(!STATE.drawing) return;
      STATE.drawing = false;

      const rect = box.getBoundingClientRect();
      box.style.display = "none";

      const w = rect.width;
      const h = rect.height;

      if(w < 8 || h < 8){
        toast("Rectangle too small.");
        return;
      }

      // Convert viewport -> document coordinates
      const docLeft = rect.left + window.scrollX;
      const docTop = rect.top + window.scrollY;

      createBlurBlock(docLeft, docTop, w, h);
      toast("Rectangle blur added.");
    });

    // Escape cancels drawing or dragging
    window.addEventListener("keydown", (e) => {
      if(e.key !== "Escape") return;
      if(STATE.drawing){
        STATE.drawing = false;
        box.style.display = "none";
        toast("Canceled.");
      }else if(STATE.dragging){
        endDrag(true);
        toast("Move canceled.");
      }
    }, true);
  }

  /* ---------- Dragging blur blocks ---------- */

  // Topmost blur block under a viewport point (the draw overlay covers blocks, so hit-test manually)
  function blurBlockAt(x, y){
    const blocks = document.querySelectorAll(".ab-blur-block");
    for(let i = blocks.length - 1; i >= 0; i--){
      const r = blocks[i].getBoundingClientRect();
      if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return blocks[i];
    }
    return null;
  }

  function startDrag(el, e){
    e.preventDefault();
    e.stopPropagation();

    STATE.dragging = {
      el,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: parseFloat(el.style.left) || 0,
      startTop: parseFloat(el.style.top) || 0,
      startScrollX: window.scrollX,
      startScrollY: window.scrollY,
      lastX: e.clientX,
      lastY: e.clientY
    };

    // Bring to front so it stays on top of overlapping blurs
    el.parentNode.appendChild(el);
    el.classList.add("ab-dragging");
    if(overlay) overlay.style.cursor = "grabbing";

    window.addEventListener("mousemove", onDragMove, true);
    window.addEventListener("mouseup", onDragEnd, true);
    window.addEventListener("scroll", onDragScroll, true);
  }

  function positionDragged(){
    const d = STATE.dragging;
    const el = d.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const docEl = document.documentElement;
    const maxLeft = Math.max(0, Math.max(docEl.scrollWidth, document.body.scrollWidth) - w);
    const maxTop = Math.max(0, Math.max(docEl.scrollHeight, document.body.scrollHeight) - h);

    const left = d.startLeft + (d.lastX - d.startX) + (window.scrollX - d.startScrollX);
    const top = d.startTop + (d.lastY - d.startY) + (window.scrollY - d.startScrollY);

    el.style.left = `${clamp(left, 0, maxLeft)}px`;
    el.style.top = `${clamp(top, 0, maxTop)}px`;
  }

  function onDragMove(e){
    if(!STATE.dragging) return;
    STATE.dragging.lastX = e.clientX;
    STATE.dragging.lastY = e.clientY;
    positionDragged();
    e.preventDefault();
  }

  // Keep the block under the cursor if the page scrolls mid-drag (e.g. mouse wheel)
  function onDragScroll(){
    if(STATE.dragging) positionDragged();
  }

  function onDragEnd(e){
    if(!STATE.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag(false);
  }

  function endDrag(revert){
    const d = STATE.dragging;
    if(!d) return;
    if(revert){
      d.el.style.left = `${d.startLeft}px`;
      d.el.style.top = `${d.startTop}px`;
    }
    d.el.classList.remove("ab-dragging");
    if(overlay) overlay.style.cursor = "";
    STATE.dragging = null;

    window.removeEventListener("mousemove", onDragMove, true);
    window.removeEventListener("mouseup", onDragEnd, true);
    window.removeEventListener("scroll", onDragScroll, true);
  }

  function enableDrawingOverlay(){
    ensureOverlay();
    overlay.style.display = "block";
  }

  function disableDrawingOverlay(){
    ensureOverlay();
    overlay.style.display = "none";
    STATE.drawing = false;
    box.style.display = "none";
  }

  function createBlurBlock(left, top, width, height){
    ensureGlobalStyle();
    const el = createEl("div", {
      class: "ab-blur-block",
      style: {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      }
    });

    // For maximum compatibility, set explicit blur too
    el.style.backdropFilter = `blur(${STATE.radiusPx}px)`;
    el.style.webkitBackdropFilter = `blur(${STATE.radiusPx}px)`;

    // Allow remove mode
    el.addEventListener("mouseenter", () => {
      if(STATE.tool === "remove") el.classList.add("ab-remove-hover");
    });
    el.addEventListener("mouseleave", () => el.classList.remove("ab-remove-hover"));
    // Direct drag when the draw overlay isn't covering the block (sidebar closed, text tool)
    el.addEventListener("mousedown", (e) => {
      if(e.button !== 0 || STATE.tool === "remove") return;
      startDrag(el, e);
    });
    el.addEventListener("click", (e) => {
      if(STATE.tool !== "remove") return;
      el.remove();
      toast("Removed blur.");
      e.stopPropagation();
      e.preventDefault();
    });

    document.body.appendChild(el);
    return el;
  }

  /* ---------- Text blur ---------- */

  function blurCurrentSelection(){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if(range.collapsed) return;

    // Avoid blurring inside our sidebar or overlay
    const common = range.commonAncestorContainer;
    if(common && common.nodeType === 1){
      const el = common;
      if(el.closest && (el.closest("#ab-sidebar-host") || el.closest("#ab-draw-overlay"))) return;
    }else if(common && common.parentElement){
      const pe = common.parentElement;
      if(pe.closest && (pe.closest("#ab-sidebar-host") || pe.closest("#ab-draw-overlay"))) return;
    }

    // Try robust wrapping
    try{
      const extracted = range.extractContents();
      const wrap = document.createElement("span");
      wrap.className = "ab-text-blur";
      wrap.style.filter = `blur(${STATE.radiusPx}px)`;
      wrap.appendChild(extracted);

      // Remove mode interactions
      wrap.addEventListener("mouseenter", () => {
        if(STATE.tool === "remove") wrap.classList.add("ab-remove-hover");
      });
      wrap.addEventListener("mouseleave", () => wrap.classList.remove("ab-remove-hover"));
      wrap.addEventListener("click", (e) => {
        if(STATE.tool !== "remove") return;
        wrap.replaceWith(...wrap.childNodes);
        toast("Removed text blur.");
        e.stopPropagation();
        e.preventDefault();
      });

      range.insertNode(wrap);

      // Clear selection
      sel.removeAllRanges();

      toast("Text blurred.");
    }catch(err){
      toast("Couldn't blur that selection. Try selecting a smaller chunk of text.");
      // Restore selection remains as-is
    }
  }

  // When in text tool mode, blur selection on mouseup
  function handleMouseUp(e){
    if(STATE.tool !== "text") return;
    if(isEditableTarget(e.target)) return;
    // Defer to let selection finalize
    setTimeout(() => blurCurrentSelection(), 0);
  }

  /* ---------- Remove tool hover hint for text spans ---------- */
  function handleMouseMove(e){
    if(STATE.tool !== "remove") return;
    const t = e.target;
    if(!t) return;
    // Provide hover outline only for our blur items
    if(t.classList && (t.classList.contains("ab-blur-block") || t.classList.contains("ab-text-blur"))){
      t.classList.add("ab-remove-hover");
    }
  }
  function handleMouseOut(e){
    const t = e.target;
    if(!t) return;
    if(t.classList && t.classList.contains("ab-remove-hover")){
      t.classList.remove("ab-remove-hover");
    }
  }

  /* ---------- Messaging / Toggle ---------- */

  function toggleSidebar(){
    mountUI();
    setSidebarOpen(!STATE.sidebarOpen);
    if(STATE.sidebarOpen){
      toast("AutoBlur opened.");
      setTool(STATE.tool);
    }else{
      // keep tool, but stop overlay
      disableDrawingOverlay();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if(!msg || !msg.type) return;
    if(msg.type === "AUTO_BLUR_TOGGLE"){
      toggleSidebar();
    }
  });

  /* ---------- Boot ---------- */

  function boot(){
    mountUI();

    // Hide sidebar on load
    setSidebarOpen(false);

    setTool("rect");

    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseout", handleMouseOut, true);

    // Optional: remove startup toast
    // toast("AutoBlur ready. Use the sidebar to choose a tool.");
}


})();
