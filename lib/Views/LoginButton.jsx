import React from "react";
import Icon from "terriajs/lib/Styled/Icon";
import classNames from "classnames";
import Styles from "terriajs/lib/ReactViews/Map/menu-button.scss";
function LoginButton(props) {
  return (
    <div
          className={classNames(Styles.btnAboutLink)}
          title={"Login"}
          style= {{borderRadius: "0 16px 16px 0"}}
          onClick={props.onClick}
        >
          {<Icon glyph={Icon.GLYPHS.user} />}
          <span>{props.caption}</span>
        </div>
  );
}

export default LoginButton;
