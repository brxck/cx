import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { CreateWorkspace } from "./pages/CreateWorkspace";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<CreateWorkspace />} />
      </Routes>
    </BrowserRouter>
  );
}
