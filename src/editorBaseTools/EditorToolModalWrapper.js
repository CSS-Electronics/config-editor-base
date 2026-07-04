import React from "react";
import classNames from "classnames";

class EditorToolModalWrapper extends React.Component{
  constructor(props) {
    super(props);
  }

  render(){
    return (
      <div className={classNames('tools-side-bar', { 'tools-side-bar-expanded': this.props.isExpanded })}>
        {this.props.name === 'filter-builder-modal' && (
          <button type="button" className="close expand-toggle" onClick={this.props.onToggleExpand}>
            <span style={{ color: "gray" }}>{this.props.isExpanded ? '\u00BB' : '\u00AB'}</span>
          </button>
        )}
        <button type="button" className="close" onClick={this.props.onClick}>
          <span style={{ color: "gray" }}>×</span>
        </button>
        {this.props.modal}
    
      </div>
    )
  }
}

export default EditorToolModalWrapper