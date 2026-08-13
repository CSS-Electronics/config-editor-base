import React from "react";

// rjsf 6 split array rendering between ArrayFieldTemplate (list + add button)
// and ArrayFieldItemTemplate (per-item markup + move/remove buttons). The
// markup below matches the pre-6 template: items rendered as .rjsf-array-list
// rows with .special-array-buttons, plus the .array-item-add add button.
function ArrayFieldTemplate(props) {
  return (
    <div className="reset-margins">
      <legend>{props.title}</legend>
      <p>{props.schema.description}</p>
      {props.items}
      {props.canAdd && (
        <div className="add-row-button">
          <p className="col-xs-2 col-xs-offset-10 array-item-add text-right">
            <button
              className="btn btn-info btn-add col-xs-12"
              onClick={props.onAddClick}
              type="button"
            >
              <i className="glyphicon glyphicon-plus" />{" "}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

export function ArrayFieldItemTemplate(props) {
  const { children, buttonsProps } = props;
  const {
    hasMoveUp,
    hasMoveDown,
    hasRemove,
    onMoveUpItem,
    onMoveDownItem,
    onRemoveItem
  } = buttonsProps;
  return (
    <div>
      <div className="position-relative">
        <div className="rjsf-array-list">
          <div>{children}</div>
          <div className="special-array-buttons">
            {hasMoveDown && (
              <button
                type="button"
                className="btn btn-default array-item-move-down"
                onClick={onMoveDownItem}
              >
                <i className="glyphicon glyphicon-arrow-down" />
              </button>
            )}
            {hasMoveUp && (
              <button
                type="button"
                className="btn btn-default array-item-move-up"
                onClick={onMoveUpItem}
              >
                <i className="glyphicon glyphicon-arrow-up" />
              </button>
            )}
            {hasRemove && (
              <button
                type="button"
                className="btn btn-danger array-item-remove"
                onClick={onRemoveItem}
              >
                <i className="glyphicon glyphicon-remove" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ArrayFieldTemplate;
