import {
  MenuLeft,
  Nav,
  ExperimentalMenu
} from "terriajs/lib/ReactViews/StandardUserInterface/customizable/Groups";
import MenuItem from "terriajs/lib/ReactViews/StandardUserInterface/customizable/MenuItem";
import PropTypes from "prop-types";
import React, {useEffect, useState} from "react";
import RelatedMaps from "./RelatedMaps";
import MenuLogin from "./MenuLogin";
import SplitPoint from "terriajs/lib/ReactViews/SplitPoint";
import StandardUserInterface from "terriajs/lib/ReactViews/StandardUserInterface/StandardUserInterface.jsx";
import version from "../../version";

import "./global.scss";

// function loadAugmentedVirtuality(callback) {
//   require.ensure(
//     "terriajs/lib/ReactViews/Map/Navigation/AugmentedVirtualityTool",
//     () => {
//       const AugmentedVirtualityTool = require("terriajs/lib/ReactViews/Map/Navigation/AugmentedVirtualityTool");
//       callback(AugmentedVirtualityTool);
//     },
//     "AugmentedVirtuality"
//   );
// }

// function isBrowserSupportedAV() {
//   return /Android|iPhone|iPad/i.test(navigator.userAgent);
// }

export default function UserInterface(props) {
  const [loggedIn,setLoggedIn] = useState(false);
  
  useEffect(()=>{
    fetch("https://asdc.cloud.edu.au/api/projects/", {
      cache: "no-store",
      credentials: 'include'
    })
    .then(response => {
      if (response.status === 200) {
        setLoggedIn(true);
      }
    })
  },[])

  return (
    <StandardUserInterface {...props} version={version}>
      <MenuLeft>
        <MenuItem caption="About" href="about.html" key="about-link" />
        <RelatedMaps viewState={props.viewState} />
        {loggedIn ? 
          <MenuLogin
            onClick={()=>{
              fetch("https://asdc.cloud.edu.au/logout/", {
                  cache: "no-store",
                  credentials: 'include',
                  mode: 'no-cors'
                }).then(()=>{
                  setLoggedIn(false);
                })
            }}
            caption="Logout"
          />:
          <MenuLogin
            onClick={()=>{
              window.location.href = `https://asdc.cloud.edu.au/login/auth0?next=${window.location.href}`; 
            }}
            caption="Login"
          />
        }
      </MenuLeft>
      <ExperimentalMenu>
        {/* <If condition={isBrowserSupportedAV()}>
          <SplitPoint
            loadComponent={loadAugmentedVirtuality}
            viewState={props.viewState}
            terria={props.viewState.terria}
            experimentalWarning={true}
          />
        </If> */}
      </ExperimentalMenu>
    </StandardUserInterface>
  );
}

UserInterface.propTypes = {
  terria: PropTypes.object,
  viewState: PropTypes.object
};
