import { describe, expect, it } from "vitest";
import type { RepositorySnapshot } from "@/server/ingestion/types";
import { collectHttpDependencyHints, collectManifestEvidence, collectRelationshipEvidence } from "./analyze";

describe("collectManifestEvidence", () => {
  it("includes the ecosystems used by the target repositories", async () => {
    const contents: Record<string, string> = {
      "package.json": JSON.stringify({ dependencies: { react: "18" } }),
      "go.mod": "module k8s.io/kubernetes\n\nrequire (\n\t k8s.io/client-go v0.30.0\n)\n",
      "Gemfile": "source 'https://rubygems.org'\ngem 'rails'\ngem 'redis'\n",
      "build.gradle": "dependencies { implementation(\"org.apache.kafka:kafka-clients:3.8.0\") }\n",
    };
    const snapshot: RepositorySnapshot = {
      repositoryId: "owner/repo",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      fetchedAt: new Date().toISOString(),
      description: null,
      files: Object.entries(contents).map(([filePath, content]) => ({
        path: filePath,
        absolutePath: `/tmp/${filePath}`,
        sizeBytes: content.length,
        isBinary: false,
        readContent: async () => content,
      })),
    };

    const evidence = await collectManifestEvidence(snapshot);

    expect(evidence).toContain("package.json: react");
    expect(evidence).toContain("k8s.io/client-go v0.30.0");
    expect(evidence).not.toContain("require (");
    expect(evidence).toContain("Gemfile: gem 'rails', gem 'redis'");
    expect(evidence).toContain("org.apache.kafka:kafka-clients");
  });
});

describe("collectRelationshipEvidence", () => {
  it("keeps source evidence from client, route, controller, and model modules", async () => {
    const contents: Record<string, string> = {
      "client/auction/api-auction.js": "import { auth } from '../auth/auth-helper';\nexport const list = () => fetch('/api/auctions');\n",
      "client/product/api-product.js": "export const list = () => fetch('/api/products');\n",
      "server/routes/auction.routes.js": "import auctionCtrl from '../controllers/auction.controller';\nrouter.route('/api/auctions').get(auctionCtrl.list);\n",
      "server/controllers/auction.controller.js": "import Auction from '../models/auction.model';\n",
      "server/controllers/user.controller.js": "import User from '../models/user.model';\nimport stripe from 'stripe';\n",
      "server/models/auction.model.js": "import mongoose from 'mongoose';\n",
      "app/lib/activitypub/federation.rb": "require 'sidekiq'\nrequire 'json'\n",
      "pkg/controller/deployment.go": "import (\n\t\"k8s.io/client-go/rest\"\n\t\"k8s.io/apimachinery/pkg/apis/meta/v1\"\n)\n",
      "client/auction/Bidding.js": "import React from 'react';\nimport Button from '@material-ui/core/Button';\nconst io = require('socket.io-client');\n",
      "client/cart/Checkout.js": "import React from 'react';\nimport Card from '@material-ui/core/Card';\nimport {Elements} from 'react-stripe-elements';\n",
    };
    const snapshot: RepositorySnapshot = {
      repositoryId: "owner/repo",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      fetchedAt: new Date().toISOString(),
      description: null,
      files: Object.entries(contents).map(([filePath, content]) => ({
        path: filePath,
        absolutePath: `/tmp/${filePath}`,
        sizeBytes: content.length,
        isBinary: false,
        readContent: async () => content,
      })),
    };

    const evidence = await collectRelationshipEvidence(snapshot);

    expect(evidence).toContain("client/auction/api-auction.js: export const list = () => fetch('/api/auctions')");
    expect(evidence).toContain("server/routes/auction.routes.js: router.route('/api/auctions')");
    expect(evidence).toContain("server/controllers/auction.controller.js: import Auction");
    expect(evidence).toContain("server/controllers/user.controller.js: import stripe");
    expect(evidence).toContain("server/models/auction.model.js: import mongoose");
    expect(evidence).toContain("app/lib/activitypub/federation.rb: require 'sidekiq'");
    expect(evidence).toContain("pkg/controller/deployment.go: \"k8s.io/client-go/rest\"");
    expect(evidence).toContain("client/auction/Bidding.js: const io = require('socket.io-client')");
    expect(evidence).toContain("client/cart/Checkout.js: import {Elements} from 'react-stripe-elements'");

    const hints = await collectHttpDependencyHints(snapshot);
    expect(hints).toContainEqual({
      fromId: "client/auction",
      toId: "server/routes",
      fromKind: "module",
      toKind: "module",
      relationship: "http-request",
      confidence: 0.98,
    });
  });
});