import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import { domainForModule, type Domain } from "./domains";

export type InfraCategory = "database" | "cache" | "queue" | "search" | "external-api" | "frontend" | "backend" | "fullstack";

const KNOWN_CATEGORIES = new Set<InfraCategory>(["database", "cache", "queue", "search", "external-api", "frontend", "backend", "fullstack"]);

export interface InfraNode {
  id: string;
  name: string;
  category: InfraCategory;
  /** Real file ids that actually import/reference this technology. */
  fileIds: string[];
  /** Real domains those files belong to — where the physical connection is drawn to. */
  domainIds: string[];
  confidence: number;
}

/**
 * The repository's real technology dependencies — databases, caches,
 * queues, search engines, external service SDKs, and the frontend/backend
 * frameworks themselves — as diagram nodes. Built entirely from
 * `repository.frameworks` (itself derived from real source-code imports,
 * see `detectFrameworks` in the knowledge-model builder); never invents a
 * technology the repository doesn't actually depend on.
 */
export function computeInfrastructureNodes(knowledgeModel: RepositoryKnowledgeModel, domains: Domain[]): InfraNode[] {
  const fileToModule = new Map<string, string>();
  for (const m of knowledgeModel.modules) for (const fileId of m.fileIds) fileToModule.set(fileId, m.id);

  const nodes: InfraNode[] = [];
  for (const detection of knowledgeModel.repository.frameworks) {
    if (!KNOWN_CATEGORIES.has(detection.category as InfraCategory)) continue;

    const domainIds = new Set<string>();
    for (const fileId of detection.evidence) {
      const moduleId = fileToModule.get(fileId);
      const domain = moduleId ? domainForModule(domains, moduleId) : null;
      if (domain) domainIds.add(domain.id);
    }

    nodes.push({
      id: detection.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: detection.name,
      category: detection.category as InfraCategory,
      fileIds: detection.evidence,
      domainIds: [...domainIds],
      confidence: detection.confidence,
    });
  }

  // Stable order: most-connected (most files depending on it) first.
  return nodes.sort((a, b) => b.fileIds.length - a.fileIds.length || a.name.localeCompare(b.name));
}
