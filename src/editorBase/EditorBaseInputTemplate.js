import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ariaDescribedByIds, getInputProps } from "@rjsf/utils";

// rjsf 6 runs an expensive pipeline on EVERY Form change (getDefaultFormState
// over the whole schema + omitExtraData + live validation - measured at
// ~25-70 ms per keystroke on real configs, which makes held-key typing jitter).
// v5 did not re-merge defaults per keystroke, so this is a v6 regression that
// no Form prop can disable. This template keeps keystrokes local to the input
// and only propagates to the Form after a short pause (or immediately on
// blur/unmount), so the pipeline never runs inside the keystroke handler and
// held-key repeats (~30 ms apart) coalesce into a single pipeline run.
//
// Port of the v6 core BaseInputTemplate minus SchemaExamples/ClearButton
// (schema `examples` and ui:allowClearTextInputs are unused in the CANedge
// schemas).
// Single edits propagate after 20 ms (near-instant). During a rapid burst
// (held-key repeats arrive ~30 ms apart) a 20 ms timer would fire BETWEEN
// repeats and run the pipeline per keystroke again (measured +74% typing
// overhead), so bursts extend the timer just enough to coalesce until the
// key is released.
const DEBOUNCE_MS = 20;
const BURST_GAP_MS = 50; // keystrokes closer than this count as a burst
const BURST_DEBOUNCE_MS = 100;

// Registry of mounted inputs with a pending (not yet propagated) edit.
// flushPendingInputs() pushes them all into the Form synchronously - callers
// that snapshot formData right after (e.g. EditorSection's
// setConfigContentPreSubmit) must wrap the call in ReactDOM.flushSync so the
// Form's onChange (invoked from a setState callback) also lands synchronously.
const pendingFlushes = new Set();

export const flushPendingInputs = () => {
  pendingFlushes.forEach((flush) => flush());
};

export default function EditorBaseInputTemplate(props) {
  const {
    id,
    name, // remove from ...rest
    htmlName,
    value,
    readonly,
    disabled,
    autofocus,
    onBlur,
    onFocus,
    onChange,
    onChangeOverride,
    options,
    schema,
    uiSchema, // remove from ...rest
    registry, // remove from ...rest
    rawErrors, // remove from ...rest
    type,
    hideLabel, // remove from ...rest
    hideError, // remove from ...rest
    ...rest
  } = props;

  const inputProps = {
    ...rest,
    ...getInputProps(schema, type, options)
  };

  let inputValue;
  if (inputProps.type === "number" || inputProps.type === "integer") {
    inputValue = value || value === 0 ? value : "";
  } else {
    inputValue = value == null ? "" : value;
  }

  const [localValue, setLocalValue] = useState(inputValue);
  const localValueRef = useRef(inputValue);
  const timerRef = useRef(null);
  const pendingRef = useRef(false);
  const focusedRef = useRef(false);
  const propagateRef = useRef(null);

  const propagate = (raw) => {
    pendingRef.current = false;
    onChange(raw === "" ? options.emptyValue : raw);
  };
  propagateRef.current = propagate;

  // Adopt external value changes (config load, dependency defaults, tab
  // switches) whenever there is no local edit in flight.
  useEffect(() => {
    if (!pendingRef.current && !focusedRef.current) {
      setLocalValue(inputValue);
      localValueRef.current = inputValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  // Register in the pending-flush registry and flush any pending edit on
  // unmount so it is not lost (e.g. the per-render form remount in
  // EditorSection).
  useEffect(() => {
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pendingRef.current && propagateRef.current) {
        propagateRef.current(localValueRef.current);
      }
    };
    pendingFlushes.add(flush);
    return () => {
      pendingFlushes.delete(flush);
      flush();
    };
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current && propagateRef.current) {
      propagateRef.current(localValueRef.current);
    }
  }, []);

  const lastKeystrokeRef = useRef(0);

  const handleChange = useCallback((event) => {
    const raw = event.target.value;
    setLocalValue(raw);
    localValueRef.current = raw;
    pendingRef.current = true;
    const now = Date.now();
    const delay =
      now - lastKeystrokeRef.current < BURST_GAP_MS
        ? BURST_DEBOUNCE_MS
        : DEBOUNCE_MS;
    lastKeystrokeRef.current = now;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (pendingRef.current && propagateRef.current) {
        propagateRef.current(localValueRef.current);
      }
    }, delay);
  }, []);

  // Enter inside a text input triggers the <form>'s implicit submission, which
  // fires BEFORE any blur - rjsf would hand onSubmit a formData snapshot that
  // predates the pending debounced edit, and the form remount that follows
  // would then flush it into an already-unmounted Form (setState callback never
  // runs), silently dropping the last characters. flushSync so the Form's
  // onChange lands before the submit event is dispatched.
  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter") {
        flushSync(() => flush());
      }
    },
    [flush]
  );

  const handleBlur = useCallback(
    ({ target }) => {
      focusedRef.current = false;
      flush();
      onBlur(id, target && target.value);
    },
    [onBlur, id, flush]
  );

  const handleFocus = useCallback(
    ({ target }) => {
      focusedRef.current = true;
      onFocus(id, target && target.value);
    },
    [onFocus, id]
  );

  return (
    <input
      id={id}
      name={htmlName || id}
      className="form-control"
      readOnly={readonly}
      disabled={disabled}
      autoFocus={autofocus}
      value={localValue}
      {...inputProps}
      onChange={onChangeOverride || handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onFocus={handleFocus}
      aria-describedby={ariaDescribedByIds(id, false)}
    />
  );
}
