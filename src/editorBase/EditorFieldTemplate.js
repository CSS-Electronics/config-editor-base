import React from "react";
import { getDefaultRegistry } from "@rjsf/core";

const { FieldTemplate: DefaultFieldTemplate } = getDefaultRegistry().templates;

// rjsf 6 renamed the per-field wrapper classes: v5 rendered
// "form-group field field-<type>" (+ "field-error has-error has-danger" on
// errors), v6 renders "rjsf-field rjsf-field-<type>" (+ "rjsf-field-error").
// Consumer apps' CSS keys on the v5 names - including [class*="form-group field
// field-object"] substring selectors and the hover-tooltip field descriptions
// (.field-string:hover .field-description) - so rebuild the v5 class string
// verbatim (order matters for the substring selectors) and append the v6
// classes after it.
const withLegacyClassNames = (classNames = "") => {
  const parts = classNames.split(" ").filter(Boolean);
  const hasError = parts.includes("rjsf-field-error");
  const type = parts
    .map((c) => (c.startsWith("rjsf-field-") ? c.slice("rjsf-field-".length) : null))
    .find((t) => t && t !== "error");
  const extras = parts.filter((c) => c !== "rjsf-field" && !c.startsWith("rjsf-field-"));

  const legacy = ["form-group", "field"];
  if (type) legacy.push(`field-${type}`);
  if (hasError) legacy.push("field-error", "has-error", "has-danger");

  return [...legacy, ...extras, ...parts.filter((c) => c.startsWith("rjsf-field"))].join(" ");
};

export default function EditorFieldTemplate(props) {
  return (
    <DefaultFieldTemplate {...props} classNames={withLegacyClassNames(props.classNames)} />
  );
}
