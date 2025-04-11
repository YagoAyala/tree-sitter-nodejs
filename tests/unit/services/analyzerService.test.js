const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const {
  cloneRepositoryIfMissing,
  removeRepositoryDirectory,
  findAllValidFiles,
  traverseSyntaxTree,
  containsJsx,
  extractRequireCalls,
  parseSingleImportDeclaration,
  isFunctionOrArrowFunction,
  nodeIsExported,
  getExportedClassName,
  getExportedFunctionName,
  getExportedVariableNames,
  getExportDefaultName,
  collectLocalExportedComponents,
  handleRepositoryAnalyzeLogic
} = require("../../../src/services/analyzerService");

afterAll(() => {
  removeRepositoryDirectory(path.join(__dirname, "ecommerce-react"));
});

describe("cloneRepositoryIfMissing", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not clone if directory exists", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    const spawnSyncMock = jest.spyOn(childProcess, "spawnSync");
    cloneRepositoryIfMissing("https://github.com/jgudo/ecommerce-react", "targetDir/ecommerce-react", "ecommerce-react");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});

describe("removeRepositoryDirectory", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes directory if it exists", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    const rmSyncMock = jest.spyOn(fs, "rmSync").mockImplementation(() => { });
    removeRepositoryDirectory("fakeDir");
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing if directory does not exist", () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const rmSyncMock = jest.spyOn(fs, "rmSync");
    removeRepositoryDirectory("fakeDir");
    expect(rmSyncMock).not.toHaveBeenCalled();
  });
});

describe("findAllValidFiles", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns files with valid extensions", () => {
    jest.spyOn(fs, "readdirSync").mockImplementation((dir) => {
      if (dir === "/testDir") {
        return ["file.js", "file.txt", "subdir"];
      }
      if (dir === "/testDir/subdir") {
        return ["another.jsx", "notes.md"];
      }
      return [];
    });
    jest.spyOn(fs, "statSync").mockImplementation((p) => {
      if (p.endsWith("subdir") && !p.endsWith(".jsx") && !p.endsWith(".md")) {
        return { isDirectory() { return true; } };
      }
      return { isDirectory() { return false; } };
    });
    const validExtensions = new Set([".js", ".jsx"]);
    const result = findAllValidFiles("/testDir", validExtensions);
    expect(result).toEqual([
      path.join("/testDir", "file.js"),
      path.join("/testDir", "subdir", "another.jsx")
    ]);
  });
});

describe("traverseSyntaxTree", () => {
  it("calls callback for each node in a simple tree", () => {
    const rootNode = {
      type: "root",
      childCount: 2,
      child(i) {
        return { type: `child_${i}`, childCount: 0, child() { return null; } };
      }
    };
    const visited = [];
    traverseSyntaxTree(rootNode, (node) => {
      visited.push(node.type);
    });
    expect(visited).toEqual(["root", "child_0", "child_1"]);
  });
});

describe("containsJsx", () => {
  it("detects jsx in a tree", () => {
    const tree = {
      rootNode: {
        childCount: 1,
        type: "program",
        child() { return { type: "jsx_element", childCount: 0, child() { return null; } }; }
      }
    };
    expect(containsJsx(tree)).toBe(true);
  });

  it("returns false if no jsx", () => {
    const tree = {
      rootNode: {
        childCount: 1,
        type: "program",
        child() { return { type: "expression_statement", childCount: 0, child() { return null; } }; }
      }
    };
    expect(containsJsx(tree)).toBe(false);
  });
});

describe("extractRequireCalls", () => {
  it("finds require('module') calls", () => {
    const root = {
      type: "program",
      childCount: 1,
      child() {
        return {
          type: "call_expression",
          childCount: 2,
          child(i) {
            if (i === 0) {
              return { type: "identifier", startIndex: 0, endIndex: 7 };
            }
            return {
              childCount: 1,
              child() { return { type: "string", startIndex: 8, endIndex: 16 }; }
            };
          }
        };
      }
    };
    const code = "require('module')";
    const result = extractRequireCalls(root, code);
    expect(result).toEqual(["module"]);
  });
});

describe("parseSingleImportDeclaration", () => {
  it("parses import source", () => {
    const importNode = {
      childForFieldName(field) {
        if (field === "source" || field === "module_name") {
          return { startIndex: 20, endIndex: 27 };
        }
        return null;
      },
      childCount: 0
    };
    const code = `import Default from "module"`;
    const result = parseSingleImportDeclaration(importNode, code);
    expect(result.source).toBe("module");
  });
});

describe("isFunctionOrArrowFunction", () => {
  it("returns true for function type", () => {
    expect(isFunctionOrArrowFunction({ type: "function" })).toBe(true);
  });
  it("returns true for arrow_function type", () => {
    expect(isFunctionOrArrowFunction({ type: "arrow_function" })).toBe(true);
  });
  it("returns false for null", () => {
    expect(isFunctionOrArrowFunction(null)).toBe(false);
  });
});

describe("nodeIsExported", () => {
  it("returns true if an ancestor is an export node", () => {
    const node = { type: "function_declaration", parent: { type: "export_statement" } };
    expect(nodeIsExported(node)).toBe(true);
  });
  it("returns false if no export ancestor", () => {
    const node = { type: "function_declaration", parent: null };
    expect(nodeIsExported(node)).toBe(false);
  });
});

describe("getExportedClassName", () => {
  it("returns class name if exported", () => {
    const node = {
      type: "class_declaration",
      parent: { type: "export_statement" },
      childForFieldName(f) {
        if (f === "name") { return { startIndex: 13, endIndex: 16 }; }
        return null;
      }
    };
    const code = "export class Foo {}";
    expect(getExportedClassName(node, code)).toBe("Foo");
  });
  it("returns null if not exported", () => {
    const node = {
      type: "class_declaration",
      parent: null,
      childForFieldName(f) {
        if (f === "name") { return { startIndex: 6, endIndex: 9 }; }
        return null;
      }
    };
    const code = "class Foo {}";
    expect(getExportedClassName(node, code)).toBe(null);
  });
});

describe("getExportedFunctionName", () => {
  it("returns function name if exported", () => {
    const node = {
      type: "function_declaration",
      parent: { type: "export_statement" },
      childForFieldName(f) {
        if (f === "name") { return { startIndex: 16, endIndex: 19 }; }
        return null;
      }
    };
    const code = "export function foo() {}";
    expect(getExportedFunctionName(node, code)).toBe("foo");
  });
});

describe("getExportedVariableNames", () => {
  it("returns variable names of exported arrow functions", () => {
    const node = {
      type: "variable_declaration",
      parent: { type: "export_statement" },
      childCount: 1,
      child() {
        return {
          type: "variable_declarator",
          childForFieldName(f) {
            if (f === "name") { return { startIndex: 13, endIndex: 16 }; }
            if (f === "value") { return { type: "arrow_function" }; }
            return null;
          }
        };
      }
    };
    const code = "export const foo = () => {}";
    expect(getExportedVariableNames(node, code)).toEqual(["foo"]);
  });
});

describe("getExportDefaultName", () => {
  it("returns default export function name", () => {
    const node = {
      childForFieldName(f) {
        if (f === "declaration") {
          return {
            type: "function_declaration",
            childForFieldName(ff) {
              if (ff === "name") { return { startIndex: 24, endIndex: 27 }; }
              return null;
            }
          };
        }
        return null;
      }
    };
    const code = "export default function foo() {}";
    expect(getExportDefaultName(node, code)).toBe("foo");
  });
});

describe("collectLocalExportedComponents", () => {
  it("collects exported class and function names", () => {
    const mockTree = {
      rootNode: {
        childCount: 2,
        child(i) {
          if (i === 0) {
            return {
              type: "class_declaration",
              parent: { type: "export_statement" },
              childForFieldName(f) {
                if (f === "name") { return { startIndex: 13, endIndex: 16 }; }
                return null;
              }
            };
          }
          return {
            type: "function_declaration",
            parent: { type: "export_statement" },
            childForFieldName(f) {
              if (f === "name") { return { startIndex: 36, endIndex: 39 }; }
              return null;
            }
          };
        }
      }
    };
    const code = "export class Foo {} export function Bar() {}";
    const result = collectLocalExportedComponents(mockTree, code);
    expect(result).toEqual(["Foo", "Bar"]);
  });
});

describe("handleRepositoryAnalyzeLogic", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs without throwing", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readdirSync").mockReturnValue([]);
    jest.spyOn(fs, "statSync").mockReturnValue({ isDirectory() { return false; } });
    jest.spyOn(fs, "rmSync").mockImplementation(() => { });
    const results = await handleRepositoryAnalyzeLogic("https://github.com/jgudo/ecommerce-react");
    expect(Array.isArray(results)).toBe(true);
  });
});