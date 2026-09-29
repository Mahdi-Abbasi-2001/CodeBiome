import { describe, expect, it } from "vitest";
import type { RepositorySnapshot } from "@/server/ingestion/types";
import { collectHttpDependencyHints, collectRelationshipEvidence } from "./analyze";

describe("collectRelationshipEvidence", () => {
  it("keeps source evidence from client, route, controller, and model modules", async () => {
    const contents: Record<string, string> = {
      "client/auction/api-auction.js": "import { auth } from '../auth/auth-helper';\nexport const list = () => fetch('/api/auctions');\n",
      "client/product/api-product.js": "export const list = () => fetch('/api/products');\n",
      "server/routes/auction.routes.js": "import auctionCtrl from '../controllers/auction.controller';\nrouter.route('/api/auctions').get(auctionCtrl.list);\n",
      "server/controllers/auction.controller.js": "import Auction from '../models/auction.model';\n",
      "server/controllers/user.controller.js": "import User from '../models/user.model';\nimport stripe from 'stripe';\n",
      "server/models/auction.model.js": "import mongoose from 'mongoose';\n",
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