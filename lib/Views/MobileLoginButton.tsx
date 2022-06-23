import React from "react";
import Icon, { GLYPHS } from "terriajs/lib/Styled/Icon";

import Styles from "terriajs/lib/ReactViews/Mobile/mobile-menu-item.scss";

type Props = {
  href?: string;
  onClick: React.MouseEventHandler<HTMLElement>;
  caption: string;
  icon: { id: keyof typeof GLYPHS };
};

export default (props: Props) => (
  <div className={Styles.root}>
      <div
        onClick={props.onClick}
        className={Styles.link}
      >
        {props.caption}
        <Icon glyph={GLYPHS.user} />
      </div>
  </div>
);
