import LoginButton from "./LoginButton";
import MobileLoginButton from "./MobileLoginButton"
import responsiveSwitch from "terriajs/lib/ReactViews/StandardUserInterface/customizable/ResponsiveSwitch";
import withControlledVisibility from "terriajs/lib/ReactViews/HOCs/withControlledVisibility";

const MenuLogin = withControlledVisibility(
  responsiveSwitch(LoginButton, MobileLoginButton)
);

export default MenuLogin;
