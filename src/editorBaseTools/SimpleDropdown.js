import React from "react";
import Select from "react-select";

/**
 * SimpleDropdown - A reusable dropdown component without file upload functionality.
 * Based on EditorDropdown styling for consistency.
 * 
 * Props:
 * - name: Label text to display
 * - options: Array of { value, label } objects
 * - value: Currently selected value
 * - onChange: Callback function(selectedOption) when selection changes
 * - comment: Optional description text
 * - disabled: Optional boolean to disable the dropdown
 */
class SimpleDropdown extends React.Component {
  constructor(props) {
    super(props);
  }

  handleSelectChange = (selectedOption) => {
    if (this.props.onChange) {
      this.props.onChange(selectedOption);
    }
  };

  render() {
    const { name, options, value, comment, disabled } = this.props;

    // Find the current option object from value
    const currentOption = options.find(opt => opt.value === value) || options[0];

    return (
      <div className="form-group pl0 field-string">
        {name}
        <Select
          isDisabled={disabled}
          value={currentOption}
          options={options}
          onChange={this.handleSelectChange}
          isSearchable={false}
        />
        {comment && (
          <span className="field-description field-description-shift">
            {comment}
          </span>
        )}
      </div>
    );
  }
}

export default SimpleDropdown;
