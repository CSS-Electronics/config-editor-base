import React from "react";
import { GENERIC_NAV } from "rjsf-tabs";

function EditorNavs({ navs: { links }, onNavChange }) {
  let relLinks = links.filter(({ nav }) => nav !== GENERIC_NAV);
  return (
    <div className="col-md-12">
    <nav className="navbar navbar-default navbar-margin-reduce">
      <div className="container-fluid">
        <div className="collapse navbar-collapse">
          <ul className="nav navbar-nav navbar-ul-margin-reduce">
            {relLinks.map(({ nav, name, icon, isActive }, i) => (
              nav !== "GEOFENCE" ? ( // short term fix for CANmod.gps FW 01.03.01 uischema bug
              <li
                key={i}
                onClick={() => onNavChange(nav)}
                className={isActive ? "active bottom-border" : null}
              >
                <a className={isActive ? "nav-active" : null}>
                  {icon && <span className={icon} aria-hidden="true" />}
                  &nbsp;{name || nav}
                </a>
              </li>) : null
            ))}
          </ul>
        </div>
      </div>
    </nav>
    </div>
  );
}

export default EditorNavs;
