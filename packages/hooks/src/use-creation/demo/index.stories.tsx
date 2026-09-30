/**
 * https://react.dev/reference/react/useMemo#preventing-an-effect-from-firing-too-often
 *
 * https://react.dev/learn/removing-effect-dependencies#move-dynamic-objects-and-functions-inside-your-effect
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import Demo1 from "./demo1.js";

const meta: Meta = {
  title: "Hooks/useCreation",
  component: Demo1,
};

export default meta;

export const DemoStory1: StoryObj = {};
