const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const Parser = require("tree-sitter");
const TreeSitterJS = require("tree-sitter-javascript");
const TreeSitterTS = require("tree-sitter-typescript").typescript;

const cloneRepositoryIfMissing = (repositoryUrl, targetDirectory, projectName) => {
    if (!fs.existsSync(targetDirectory)) {
        spawnSync("git", ["clone", repositoryUrl, projectName], {
            cwd: path.dirname(targetDirectory),
            stdio: "inherit",
        });
    }
};

const removeRepositoryDirectory = (directoryPath) => {
    if (fs.existsSync(directoryPath)) {
        fs.rmSync(directoryPath, { recursive: true, force: true });
    }
};

const findAllValidFiles = (directoryPath, validExtensions, results = []) => {
    const entries = fs.readdirSync(directoryPath);
    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            findAllValidFiles(fullPath, validExtensions, results);
        }

        if (!stats.isDirectory()) {
            const extension = path.extname(fullPath).toLowerCase();
            if (validExtensions.has(extension)) {
                results.push(fullPath);
            }
        }
    }

    return results;
};

const traverseSyntaxTree = (rootNode, callback) => {
    if (!rootNode) {
        return;
    }
    callback(rootNode);

    for (let i = 0; i < rootNode.childCount; i++) {
        traverseSyntaxTree(rootNode.child(i), callback);
    }
};

const containsJsx = (tree) => {
    let foundJsx = false;
    traverseSyntaxTree(tree.rootNode, (node) => {
        if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") {
            foundJsx = true;
        }
    });

    return foundJsx;
};

const extractRequireCalls = (rootNode, fileContent) => {
    const requirePaths = [];
    traverseSyntaxTree(rootNode, (node) => {
        if (node.type === "call_expression") {
            const callee = node.child(0);
            if (callee && callee.type === "identifier") {
                const calleeName = fileContent.slice(callee.startIndex, callee.endIndex);
                if (calleeName === "require") {
                    const argsNode = node.child(1);
                    if (argsNode) {
                        for (let i = 0; i < argsNode.childCount; i++) {
                            const argument = argsNode.child(i);
                            if (argument.type === "string") {
                                const importPath = fileContent
                                    .slice(argument.startIndex, argument.endIndex)
                                    .replace(/['"`]/g, "");
                                requirePaths.push(importPath);
                            }
                        }
                    }
                }
            }
        }
    });
    return requirePaths;
};

const parseSingleImportDeclaration = (importNode, fileContent) => {
    const importData = {
        source: "",
        defaultImport: null,
        namedImports: [],
        namespaceImport: null,
    };
    const sourceField = importNode.childForFieldName("source") || importNode.childForFieldName("module_name");

    if (sourceField) {
        importData.source = fileContent.slice(sourceField.startIndex, sourceField.endIndex).replace(/['"`]/g, "");
    }

    traverseSyntaxTree(importNode, (childNode) => {
        const type = childNode.type;
        if (type === "import_clause") {
            const name = childNode.childForFieldName("name");

            if (name) {
                importData.defaultImport = fileContent.slice(name.startIndex, name.endIndex);
            }
        }

        if (type === "import_specifier") {
            const specNameNode = childNode.childForFieldName("name");
            const aliasNode = childNode.childForFieldName("alias");
            if (specNameNode && aliasNode) {
                const originalName = fileContent.slice(specNameNode.startIndex, specNameNode.endIndex);
                const aliasName = fileContent.slice(aliasNode.startIndex, aliasNode.endIndex);
                importData.namedImports.push(originalName + " as " + aliasName);
            }
            if (specNameNode && !aliasNode) {
                importData.namedImports.push(fileContent.slice(specNameNode.startIndex, specNameNode.endIndex));
            }
        }

        if (type === "namespace_import") {
            const starNode = childNode.child(0);
            const aliasNode = childNode.child(2);

            if (starNode && aliasNode) {
                const st = fileContent.slice(starNode.startIndex, starNode.endIndex);
                const al = fileContent.slice(aliasNode.startIndex, aliasNode.endIndex);
                importData.namespaceImport = st + " as " + al;
            }

            if (!starNode || !aliasNode) {
                importData.namespaceImport = fileContent.slice(childNode.startIndex, childNode.endIndex);
            }
        }

        if (type === "import_identifier") {
            if (!importData.defaultImport) {
                importData.defaultImport = fileContent.slice(childNode.startIndex, childNode.endIndex);
            }
        }
    });

    return importData;
};

const collectImportsFromTree = (tree, fileContent) => {
    const importsCollected = [];
    traverseSyntaxTree(tree.rootNode, (node) => {
        if (node.type === "import_declaration" || node.type === "import_statement") {
            importsCollected.push(parseSingleImportDeclaration(node, fileContent));
        }
    });

    const requireCalls = extractRequireCalls(tree.rootNode, fileContent);
    for (const pathItem of requireCalls) {
        importsCollected.push({
            source: pathItem,
            defaultImport: null,
            namedImports: [],
            namespaceImport: null,
        });
    }

    return importsCollected;
};

const isFunctionOrArrowFunction = (node) => {
    if (!node) {
        return false;
    }

    if (node.type.includes("arrow_function") || node.type === "function") {
        return true;
    }

    if (node.type === "parenthesized_expression" && node.childCount === 1) {
        return isFunctionOrArrowFunction(node.child(0));
    }

    return false;
};

const nodeIsExported = (node) => {
    let currentNode = node;
    while (currentNode) {
        const type = currentNode.type;
        const trueTypes = ["export_statement", "export_named_declaration", "export_default_declaration", "export_declaration"];

        if (trueTypes.includes(type)) {
            return true;
        }

        currentNode = currentNode.parent;
    }

    return false;
};

const getExportedClassName = (node, fileContent) => {
    if (!nodeIsExported(node)) {
        return null;
    }

    const nameNode = node.childForFieldName("name");

    if (!nameNode) {
        return null;
    }

    return fileContent.slice(nameNode.startIndex, nameNode.endIndex);
};

const getExportedFunctionName = (node, fileContent) => {
    if (!nodeIsExported(node)) {
        return null;
    }

    const nameNode = node.childForFieldName("name");

    if (!nameNode) {
        return null;
    }

    return fileContent.slice(nameNode.startIndex, nameNode.endIndex);
};

const getExportedVariableNames = (node, fileContent) => {
    if (!nodeIsExported(node)) {
        return [];
    }

    const variableNames = [];

    for (let i = 0; i < node.childCount; i++) {
        const declarator = node.child(i);
        if (declarator.type === "variable_declarator") {
            const varNameNode = declarator.childForFieldName("name");
            const valueNode = declarator.childForFieldName("value");
            if (varNameNode && valueNode && isFunctionOrArrowFunction(valueNode)) {
                variableNames.push(fileContent.slice(varNameNode.startIndex, varNameNode.endIndex));
            }
        }
    }

    return variableNames;
};

const getExportDefaultName = (node, fileContent) => {
    const declarationNode = node.childForFieldName("declaration");
    if (!declarationNode) {
        return null;
    }

    if (declarationNode.type === "function_declaration") {
        const name = declarationNode.childForFieldName("name");
        if (name) {
            return fileContent.slice(name.startIndex, name.endIndex);
        }

        return "DefaultExport";
    }
    if (isFunctionOrArrowFunction(declarationNode) || declarationNode.type === "class_declaration") {
        const childName = declarationNode.childForFieldName("name");

        if (childName) {
            return fileContent.slice(childName.startIndex, childName.endIndex);
        }

        return "DefaultExport";
    }

    if (declarationNode.type === "identifier") {
        return fileContent.slice(declarationNode.startIndex, declarationNode.endIndex);
    }

    return null;
};

const collectLocalExportedComponents = (tree, fileContent) => {
    const exportedComponents = [];
    traverseSyntaxTree(tree.rootNode, (node) => {
        if (node.type === "class_declaration") {
            const className = getExportedClassName(node, fileContent);
            if (className) {
                exportedComponents.push(className);
            }
        }

        if (node.type === "function_declaration") {
            const functionName = getExportedFunctionName(node, fileContent);
            if (functionName) {
                exportedComponents.push(functionName);
            }
        }

        if (node.type === "variable_declaration") {
            const variableNames = getExportedVariableNames(node, fileContent);
            if (variableNames.length) {
                exportedComponents.push(...variableNames);
            }
        }

        if (node.type === "export_default_declaration") {
            const defaultName = getExportDefaultName(node, fileContent);
            if (defaultName) {
                exportedComponents.push(defaultName);
            }
        }
    });

    return [...new Set(exportedComponents)];
};

const collectImportedComponents = (importList) => {
    const componentImports = [];

    for (const item of importList) {
        if (item.defaultImport && /^[A-Z]/.test(item.defaultImport)) {
            componentImports.push({ name: item.defaultImport, source: item.source });
        }

        for (const specifier of item.namedImports) {
            const parts = specifier.split(/\s+as\s+/);
            const original = parts[0];
            let alias = null;
            if (parts.length > 1) {
                alias = parts[1];
            }
            const nameUsed = alias ? alias : original;
            if (/^[A-Z]/.test(nameUsed)) {
                componentImports.push({ name: nameUsed, source: item.source });
            }
        }

        if (item.namespaceImport) {
            const match = item.namespaceImport.match(/\*\s+as\s+(\w+)/);
            if (match) {
                const namespaceName = match[1];
                if (/^[A-Z]/.test(namespaceName)) {
                    componentImports.push({ name: namespaceName, source: item.source });
                }
            }
        }
    }

    return componentImports;
};

const analyzeFileForReactComponents = (filePath, parser) => {
    const fileContent = fs.readFileSync(filePath, "utf8");
    const parsedTree = parser.parse(fileContent);

    if (!containsJsx(parsedTree)) {
        return null;
    }

    const imports = collectImportsFromTree(parsedTree, fileContent);
    const localComponents = collectLocalExportedComponents(parsedTree, fileContent);
    const importedComponents = collectImportedComponents(imports);
    const combined = [];

    for (const componentName of localComponents) {
        combined.push({ name: componentName, source: null });
    }

    for (const imported of importedComponents) {
        const existing = combined.find((x) => x.name === imported.name && x.source === imported.source);
        if (!existing) {
            combined.push(imported);
        }
    }

    return {
        filename: filePath,
        imports,
        components: combined,
    };
};

const handleRepositoryAnalyzeLogic = async (repositoryUrl) => {
    const projectName = repositoryUrl.substring(repositoryUrl.lastIndexOf("/") + 1).replace(".git", "");
    const targetPath = path.join(__dirname, projectName);
    const validExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
    const parser = new Parser();
    const results = [];

    try {
        cloneRepositoryIfMissing(repositoryUrl, targetPath, projectName);
        const files = findAllValidFiles(targetPath, validExtensions);
        for (const filePath of files) {
            if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
                parser.setLanguage(TreeSitterTS);
            }
            if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
                parser.setLanguage(TreeSitterJS);
            }
            const fileAnalysis = analyzeFileForReactComponents(filePath, parser);
            if (fileAnalysis) {
                fileAnalysis.filename = path.relative(targetPath, filePath);
                results.push(fileAnalysis);
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        removeRepositoryDirectory(targetPath);
    }

    return results;
};

module.exports = {
    cloneRepositoryIfMissing,
    removeRepositoryDirectory,
    findAllValidFiles,
    traverseSyntaxTree,
    containsJsx,
    extractRequireCalls,
    parseSingleImportDeclaration,
    collectImportsFromTree,
    isFunctionOrArrowFunction,
    nodeIsExported,
    getExportedClassName,
    getExportedFunctionName,
    getExportedVariableNames,
    getExportDefaultName,
    collectLocalExportedComponents,
    collectImportedComponents,
    analyzeFileForReactComponents,
    handleRepositoryAnalyzeLogic
};
