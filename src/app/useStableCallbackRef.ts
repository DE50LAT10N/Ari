import { useCallback, useRef, type MutableRefObject } from "react";

export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

type AnyCallback = (...args: any[]) => any;
type StableCallback<T extends AnyCallback> = (
  ...args: Parameters<T>
) => ReturnType<T>;

export function useStableCallbackRef<T extends AnyCallback>(
  callback: T,
): MutableRefObject<T> {
  return useLatestRef(callback);
}

export function useStableCallback<T extends AnyCallback>(
  callback: T,
): StableCallback<T> {
  const callbackRef = useStableCallbackRef(callback);
  return useCallback(
    (...args: Parameters<T>) => callbackRef.current(...args) as ReturnType<T>,
    [callbackRef],
  );
}
