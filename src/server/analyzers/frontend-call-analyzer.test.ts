import { describe, it, expect } from "vitest";
import { frontendCallAnalyzer, type FrontendCallAnalyzerOutput } from "./frontend-call-analyzer";
import { entryPointAnalyzer } from "./entry-point-analyzer";
import { structureAnalyzer } from "./structure-analyzer";
import { AnalyzerRegistry } from "./registry";
import { runAnalyzers } from "./runner";
import { fakeSnapshot } from "@/server/testing/fixtures";

async function edgesFor(files: Record<string, string>) {
  const snapshot = fakeSnapshot(files);
  const registry = new AnalyzerRegistry();
  registry.register(structureAnalyzer);
  registry.register(entryPointAnalyzer);
  registry.register(frontendCallAnalyzer);
  const run = await runAnalyzers(snapshot, registry);
  const result = run.results.get("frontend-call-analyzer") as { data: FrontendCallAnalyzerOutput } | undefined;
  return result?.data.edges ?? [];
}

describe("frontend-call-analyzer", () => {
  it("resolves a fetch() call with a literal path to a real backend route as an http-request edge", async () => {
    const edges = await edgesFor({
      "src/api/server.js": `const app = require('express')();\napp.get('/api/orders', () => {});\n`,
      "src/pages/Orders.jsx": `export function Orders() {\n  return fetch('/api/orders');\n}\n`,
    });
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/pages/Orders.jsx", toId: "src/api/server.js", relationship: "http-request", confidence: 1 })
    );
  });

  it("resolves a template-literal fetch call with interpolation against a param route, at lower confidence", async () => {
    const edges = await edgesFor({
      "src/api/server.js": `const app = require('express')();\napp.get('/api/orders/:id', () => {});\n`,
      "src/pages/OrderDetail.jsx": `export function OrderDetail({ id }) {\n  return fetch(\`/api/orders/\${id}\`);\n}\n`,
    });
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/pages/OrderDetail.jsx", toId: "src/api/server.js", relationship: "http-request", confidence: 0.75 })
    );
  });

  it("never fabricates an edge for a fully dynamic (non-literal, no static prefix) call target", async () => {
    const edges = await edgesFor({
      "src/api/server.js": `const app = require('express')();\napp.get('/api/orders', () => {});\n`,
      "src/pages/Dynamic.jsx": `export function Dynamic({ url }) {\n  return fetch(url);\n}\n`,
    });
    expect(edges.filter((e) => e.relationship === "http-request")).toEqual([]);
  });

  it("resolves axios.post() the same way as fetch()", async () => {
    const edges = await edgesFor({
      "src/api/server.js": `const app = require('express')();\napp.post('/api/orders', () => {});\n`,
      "src/pages/NewOrder.jsx": `import axios from 'axios';\nexport function submit() {\n  return axios.post('/api/orders', {});\n}\n`,
    });
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/pages/NewOrder.jsx", toId: "src/api/server.js", relationship: "http-request" })
    );
  });

  it("resolves a navigate() call with a literal path to a real frontend page as a navigates-to edge", async () => {
    const edges = await edgesFor({
      "src/pages/Register.jsx": `export function Register() {\n  const navigate = useNavigate();\n  navigate('/verify');\n}\n`,
      "src/pages/Verify.jsx": `<Route path="/verify" element={<Verify />} />\n`,
    });
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/pages/Register.jsx", toId: "src/pages/Verify.jsx", relationship: "navigates-to", confidence: 1 })
    );
  });

  it("resolves a <Link to=...> the same way", async () => {
    const edges = await edgesFor({
      "src/pages/Home.jsx": `export function Home() {\n  return <Link to="/verify">Verify</Link>;\n}\n`,
      "src/pages/Verify.jsx": `<Route path="/verify" element={<Verify />} />\n`,
    });
    expect(edges).toContainEqual(
      expect.objectContaining({ fromId: "src/pages/Home.jsx", toId: "src/pages/Verify.jsx", relationship: "navigates-to" })
    );
  });

  it("ignores an external/absolute href — never treats it as an internal navigation target", async () => {
    const edges = await edgesFor({
      "src/pages/Home.jsx": `export function Home() {\n  return <a href="https://example.com">External</a>;\n}\n`,
    });
    expect(edges.filter((e) => e.relationship === "navigates-to")).toEqual([]);
  });
});
