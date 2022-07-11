"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxCluster = void 0;
const sandbox_1 = __importDefault(require("./server/sandbox"));
const cluster_1 = __importDefault(require("./cluster/cluster"));
exports.SandboxCluster = cluster_1.default;
exports.default = sandbox_1.default;
//# sourceMappingURL=index.js.map