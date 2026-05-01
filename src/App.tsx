import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Flashcards } from "./pages/Flashcards";
import { FlashcardsHub } from "./pages/FlashcardsHub";
import { OllamaGate } from "./pages/OllamaGate";
import { Onboarding } from "./pages/Onboarding";
import { RootGate } from "./pages/RootGate";
import { Settings } from "./pages/Settings";
import { Summary } from "./pages/Summary";
import { Tests } from "./pages/Tests";
import { TestsHub } from "./pages/TestsHub";
import { Upload } from "./pages/Upload";
import { DemoSummary } from "./tutorial/DemoSummary";
import { DemoFlashcards } from "./tutorial/DemoFlashcards";
import { DemoTests } from "./tutorial/DemoTests";

const router = createHashRouter([
  { path: "/", element: <RootGate /> },
  { path: "/ollama", element: <OllamaGate /> },
  { path: "/onboarding", element: <Onboarding /> },
  {
    path: "/app",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "upload", element: <Upload /> },
      { path: "summary/:id", element: <Summary /> },
      { path: "flashcards", element: <FlashcardsHub /> },
      { path: "flashcards/:id", element: <Flashcards /> },
      { path: "tests", element: <TestsHub /> },
      { path: "tests/:id", element: <Tests /> },
      { path: "settings", element: <Settings /> },
      { path: "tutorial/summary", element: <DemoSummary /> },
      { path: "tutorial/flashcards", element: <DemoFlashcards /> },
      { path: "tutorial/tests", element: <DemoTests /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
