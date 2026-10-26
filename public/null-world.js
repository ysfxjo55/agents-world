// Stands in for the 3D world when it cannot start (no WebGL: an old graphics driver, a fresh Windows laptop, or a browser setting).
// Every method does nothing, so the list, the chat and the guide keep working.
export function nullWorld(canvas) {
  return {
    renderer: { domElement: canvas }, buildings: new Map(), hover: null, broken: true,
    setTheme() {}, setInterstellar() {}, setBella() {}, setLab() {}, setAgents() {}, sync() {}, home() {}, setSelected() {},
    flyToSession() {}, setTimeOverride() {}, resize() {}, pick: () => null, screenPos: () => null,
  };
}

/** The message shown in place of the world. */
export const NO_3D = 'The 3D view could not start in this browser, so the world is hidden. Everything else works: use the list on the left and the Chat page. To get the 3D view: turn on "Use graphics acceleration when available" in your browser settings and update your graphics driver, then reload.';
