import React from "react";

// Subtle accordion-style toggle for partial config previews - light gray
// text with an expand/collapse arrow (deliberately not styled as a control
// the user feels obliged to click). The Download JSON action sits at the
// bottom of the expanded preview.
class CollapsiblePreview extends React.Component {
  render() {
    const { open, onToggle, data, onDownload, label } = this.props;

    return (
      <div style={{ marginTop: "10px" }}>
        <div
          onClick={onToggle}
          style={{
            display: "inline-flex",
            alignItems: "center",
            cursor: "pointer",
            fontSize: "12px",
            color: "#999999",
            userSelect: "none"
          }}
        >
          <i
            className={open ? "fa fa-angle-down" : "fa fa-angle-right"}
            style={{ marginRight: "6px", width: "8px" }}
          />
          {label || "Show partial config preview"}
        </div>

        {open ? (
          <div style={{ marginTop: "10px" }}>
            <pre
              className="browse-file-preview"
              style={{ maxHeight: "300px", overflow: "auto", fontSize: "11px" }}
            >
              {JSON.stringify(data, null, 2)}
            </pre>
            {onDownload ? (
              <button
                className="btn"
                onClick={onDownload}
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #ccc",
                  color: "#333",
                  marginTop: "8px"
                }}
              >
                Download JSON
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

export default CollapsiblePreview;
