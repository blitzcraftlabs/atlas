/**
 * Lazy toaster mount registry.
 *
 * Defers loading the Toaster UI until the first notification is shown.
 */

let mountToaster: (() => void) | null = null;

export function registerToasterMount(fn: (() => void) | null): void {
  mountToaster = fn;
}

export function ensureToasterMounted(): void {
  mountToaster?.();
}
