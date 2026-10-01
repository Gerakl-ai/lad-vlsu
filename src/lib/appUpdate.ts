export function canApplyAppUpdate(state: { hidden: boolean; dialogOpen: boolean; editing: boolean }) {
  return !state.hidden && !state.dialogOpen && !state.editing;
}

export function manageAppUpdates(registration: ServiceWorkerRegistration, reload: () => void) {
  let reloadPending = false;
  let controlled = Boolean(navigator.serviceWorker.controller);
  let scheduled = false;
  let activationRequested: ServiceWorker | null = null;
  const safe = () => {
    const active = document.activeElement;
    return canApplyAppUpdate({
      hidden: document.hidden,
      dialogOpen: Boolean(document.querySelector('[role="dialog"], .note-composer')),
      editing: active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select'))
    });
  };
  const apply = () => {
    scheduled = false;
    if (!reloadPending && !registration.waiting) return;
    if (!safe()) return;
    if (reloadPending) {
      reloadPending = false;
      observer.disconnect();
      reload();
    } else if (registration.waiting && activationRequested !== registration.waiting) {
      activationRequested = registration.waiting;
      registration.waiting.postMessage({ type: 'activate-update' });
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('focusout', schedule);
  document.addEventListener('visibilitychange', schedule);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) reloadPending = true;
    controlled = true;
    schedule();
  });
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', schedule);
  });
  schedule();
}
