export const baseURL =
  window.location.hostname == "localhost"
    ? "https://asdc.cloud.edu.au"
    : `${window.location.protocol}//${
        window.location.host.split('.').slice(window.location.host.split('.').length-5>0?
         window.location.host.split('.').length-5:0).join('.')}`;