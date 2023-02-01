import { unreachable } from "macro:./assert";

if (process.env.NODE_ENV !== "test") unreachable("This module should only be imported in tests");

export const mockData = {
  Copilot: {
    id: "Copilot",
    name: "Copilot",
    description: "Copilot",
    icon: "https://s3.amazonaws.com/copilot-public/images/icons/Copilot.png",
    color: "#00AEEF",
    type: "service",
    tags: ["copilot"],
    categories: ["copilot"],
    links: [
      {
        id: "Copilot",
        name: "Copilot",
        url: "https://copilot.io",
        description: "Copilot",
        icon: "https://s3.amazonaws.com/copilot-public/images/icons/Copilot.png",
        color: "#00AEEF",
        type: "service",
        tags: ["copilot"],
        categories: ["copilot"],
      },
    ],
  },
};
