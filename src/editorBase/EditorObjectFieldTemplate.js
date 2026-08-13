import React from "react";
import { descriptionId, getTemplate, getUiOptions, titleId } from "@rjsf/utils";

// Copy of rjsf 6's default ObjectFieldTemplate WITHOUT the "add property"
// expand button. rjsf 6 extended canExpand() to also trigger on
// `patternProperties`, which the CANedge schemas use everywhere as a whitelist
// for dependency-injected fields (additionalProperties:false + literal-name
// patternProperties). That made stray add-property buttons appear under those
// objects (filter items, phy, log, rtc, connect, lin lists). The editor has
// never supported add-property UI, so the button is dropped entirely -
// matching the pre-6 behavior where canExpand() only looked at
// additionalProperties.
export default function ObjectFieldTemplate(props) {
  const {
    className,
    description,
    fieldPathId,
    disabled,
    optionalDataControl,
    properties,
    readonly,
    registry,
    required,
    schema,
    title,
    uiSchema
  } = props;
  const options = getUiOptions(uiSchema);
  const TitleFieldTemplate = getTemplate("TitleFieldTemplate", registry, options);
  const DescriptionFieldTemplate = getTemplate(
    "DescriptionFieldTemplate",
    registry,
    options
  );
  // Same "pure union" shortcut as the default template
  const isPureUnionSchema =
    (schema.oneOf || schema.anyOf) && !schema.properties && properties.length === 0;
  if (isPureUnionSchema) {
    return null;
  }
  const showOptionalDataControlInTitle = !readonly && !disabled;
  return (
    <fieldset className={className} id={fieldPathId.$id}>
      {title && (
        <TitleFieldTemplate
          id={titleId(fieldPathId)}
          title={title}
          required={required}
          schema={schema}
          uiSchema={uiSchema}
          registry={registry}
          optionalDataControl={
            showOptionalDataControlInTitle ? optionalDataControl : undefined
          }
        />
      )}
      {description && (
        <DescriptionFieldTemplate
          id={descriptionId(fieldPathId)}
          description={description}
          schema={schema}
          uiSchema={uiSchema}
          registry={registry}
        />
      )}
      {!showOptionalDataControlInTitle ? optionalDataControl : undefined}
      {properties.map((prop) => prop.content)}
    </fieldset>
  );
}
