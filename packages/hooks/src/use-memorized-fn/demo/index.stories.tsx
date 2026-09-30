import type { Meta, StoryObj } from "@storybook/react-vite";
import Demo1 from "./demo1.js";
import Demo2 from "./demo2.js";

const meta: Meta = {
  title: "Hooks/{useMemorizedFn, usePersistFn}",
};

export default meta;

export const UsePersistFn: StoryObj = {
  render: () => <Demo1 />,
};

export const UseMemorizedFn: StoryObj = {
  render: () => <Demo2 />,
};
