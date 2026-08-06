const timers = new WeakMap();
const DURATION = 210;

export function showPanel(element) {
  clearTimeout(timers.get(element));
  element.hidden = false;
  element.classList.remove("is-closing");
  requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add("is-open")));
}

export function hidePanel(element, onHidden) {
  clearTimeout(timers.get(element));
  if (element.hidden) {
    onHidden?.();
    return;
  }
  element.classList.remove("is-open");
  element.classList.add("is-closing");
  const finish = () => {
    element.hidden = true;
    element.classList.remove("is-closing");
    timers.delete(element);
    onHidden?.();
  };
  if (reducedMotion()) finish();
  else timers.set(element, setTimeout(finish, DURATION));
}

export function panelIsOpen(element) {
  return !element.hidden && !element.classList.contains("is-closing");
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
