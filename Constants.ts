export const baseURL =
  window.location.hostname == "localhost"
    ? "https://asdc.cloud.edu.au"
    : (window.location.host.includes("dev.asdc.cloud.edu.au") ? "https://dev.asdc.cloud.edu.au" : "https://asdc.cloud.edu.au");