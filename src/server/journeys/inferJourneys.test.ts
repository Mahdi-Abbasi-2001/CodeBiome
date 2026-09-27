import { describe, it, expect } from "vitest";
import { buildTestKnowledgeModel } from "@/server/testing/knowledgeModelFixture";
import { inferFlows } from "@/server/flows/inferFlows";
import { inferJourneys } from "./inferJourneys";

describe("inferJourneys", () => {
  it("stitches a real register -> verify page journey from real fetch + navigate call sites", async () => {
    const model = await buildTestKnowledgeModel({
      "src/pages/Register.jsx": `import { useNavigate } from 'react-router-dom';\nexport function Register() {\n  const navigate = useNavigate();\n  async function onSubmit() {\n    await fetch('/api/register', { method: 'POST' });\n    navigate('/verify');\n  }\n  return null;\n}\n`,
      "src/pages/Verify.jsx": `<Route path="/verify" element={<Verify />} />\nexport function Verify() { return null; }\n`,
      "src/App.jsx": `<Routes>\n  <Route path="/register" element={<Register />} />\n</Routes>\n`,
      "src/api/routes/register.route.js": `import express from 'express';\nimport { RegisterController } from '../controllers/register.controller.js';\nconst app = express();\napp.post('/api/register', RegisterController.create);\n`,
      "src/api/controllers/register.controller.js": `import { RegisterService } from '../services/register.service.js';\nexport class RegisterController {\n  static create(req, res) { return RegisterService.createUser(); }\n}\n`,
      "src/api/services/register.service.js": `export class RegisterService {\n  static createUser() { return true; }\n}\n`,
    });
    const flowModel = inferFlows(model);
    const journeyModel = inferJourneys(model, flowModel);

    expect(journeyModel.journeys.length).toBeGreaterThan(0);
    const journey = journeyModel.journeys[0];
    expect(journey.steps.map((s) => s.kind)).toEqual(["page", "call", "page"]);
    expect(journey.steps[0].filePath).toBe("src/pages/Register.jsx");
    expect(journey.steps[1].kind).toBe("call");
    expect(journey.steps[1].flowId).toBeTruthy();
    expect(journey.steps[2].filePath).toBe("src/pages/Verify.jsx");
    // every step traces to real evidence, never an empty/fabricated explanation
    for (const step of journey.steps) {
      expect(step.evidence.length).toBeGreaterThan(0);
      expect(step.explanation.length).toBeGreaterThan(0);
    }
  });

  it("never fabricates a journey when a page has no real navigation onward — a lone page+call isn't a journey", async () => {
    const model = await buildTestKnowledgeModel({
      "src/pages/Orders.jsx": `export function Orders() {\n  return fetch('/api/orders');\n}\n`,
      "src/api/server.js": `const app = require('express')();\napp.get('/api/orders', () => { return []; });\n`,
    });
    const flowModel = inferFlows(model);
    const journeyModel = inferJourneys(model, flowModel);
    expect(journeyModel.journeys).toEqual([]);
  });

  it("marks the navigation hop low-confidence when a page can go to more than one real place — never silently picks one as certain", async () => {
    const model = await buildTestKnowledgeModel({
      "src/pages/Home.jsx": `export function Home() {\n  fetch('/api/home');\n  return (\n    <div>\n      <Link to="/a">A</Link>\n      <Link to="/b">B</Link>\n    </div>\n  );\n}\n`,
      "src/pages/A.jsx": `<Route path="/a" element={<A />} />\n`,
      "src/pages/B.jsx": `<Route path="/b" element={<B />} />\n`,
      "src/App.jsx": `<Routes>\n  <Route path="/home" element={<Home />} />\n</Routes>\n`,
      "src/api/server.js": `const app = require('express')();\nconst { getHome } = require('./home.controller.js');\napp.get('/api/home', getHome);\n`,
      "src/api/home.controller.js": `exports.getHome = function () { return []; };\n`,
    });
    const flowModel = inferFlows(model);
    const journeyModel = inferJourneys(model, flowModel);

    expect(journeyModel.journeys.length).toBeGreaterThan(0);
    const journey = journeyModel.journeys[0];
    const pageStep = journey.steps.find((s) => s.kind === "page" && s.filePath !== "src/pages/Home.jsx");
    expect(pageStep?.confidence).toBe("low");
    expect(journey.confidence).toBe("low");
  });
});
