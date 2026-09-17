/**
 * Extração estruturada do contrato.
 *
 * A implementação vive no motor pericial (`src/engine/extraction.js`), portado
 * do motor de geração com layouts dedicados por banco, aferição matemática e
 * achados de irregularidade. Este módulo continua sendo o ponto de entrada do
 * restante do SaaS, para que worker, testes e recálculo não dependam de onde o
 * motor mora.
 */
export { heuristicExtractionFromText, buildMathAudit } from "../engine/extraction.js";
