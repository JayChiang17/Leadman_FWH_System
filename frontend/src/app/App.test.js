import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import App from "./App";

jest.mock("./AppRouter", () => function MockAppRouter() {
  return <div>App Router Mock</div>;
});

test("renders app router container", () => {
  render(<App />);
  expect(screen.getByText("App Router Mock")).toBeInTheDocument();
});
