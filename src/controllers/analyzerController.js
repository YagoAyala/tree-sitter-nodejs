const { handleRepositoryAnalyzeLogic } = require("../services/analyzerService");

const analyseReactRepository = async (req, res) => {
    try {
        const { urlRepository } = req.query;
        const response = await handleRepositoryAnalyzeLogic(urlRepository);

        res.status(200).json(response);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

module.exports = {
    analyseReactRepository,
}