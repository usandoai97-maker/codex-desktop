'use strict';

/** Registro de plugins. Plugins simples trocam o prompt; pipelines rodam múltiplos agentes. */

const PLUGINS = [
  {
    id: 'codex_gui',
    name: 'Codex GUI',
    icon: '🎨',
    category: 'Multi-agente',
    version: '1.0.0',
    description: 'Dois agentes: um desenha a interface e os modelos 3D no Roblox Studio, outro escreve o código Luau que implementa o design.',
    pipeline: [
      {
        key: 'design',
        name: 'Designer',
        prompt: 'Você é o DESIGNER. Crie a identidade visual, o layout da GUI e os modelos 3D usando as ferramentas de geração (generate_scene, generate_mesh, generate_material) e inspecione o resultado com screen_capture. Descreva com precisão posições, cores, tamanhos e hierarquia para o programador. Não escreva código Luau.',
        toolAllow: /generate_|screen_capture|search_game_tree|http_get|upload_image|store_image/i,
      },
      {
        key: 'code',
        name: 'Developer',
        prompt: 'Você é o PROGRAMADOR. Receba o design do Designer e implemente no Roblox Studio usando execute_luau / multi_edit. Respeite exatamente cores, posições e hierarquia descritas. Depois verifique com search_game_tree e get_console_output. Corrija qualquer erro antes de terminar.',
        toolAllow: /execute_luau|multi_edit|script_read|script_search|script_grep|get_console_output|search_game_tree|inspect_instance/i,
      },
    ],
  },
  {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    icon: '🔍',
    category: 'Código',
    version: '1.0.0',
    description: 'Revisa scripts do place, aponta bugs, má práticas e problemas de segurança, com correções sugeridas.',
    prompt: 'Você é revisor de código Luau. Use script_search/script_read para inspecionar os scripts. Aponte bugs, races, memory leaks, más práticas e riscos de segurança. Para cada item: arquivo, linha, problema e correção. Não altere arquivos sem pedir.',
  },
  {
    id: 'lua_tests',
    name: 'Lua Tester',
    icon: '🧪',
    category: 'Qualidade',
    version: '1.0.0',
    description: 'Escreve e executa testes unitários de ModuleScripts, cobrindo casos de borda.',
    prompt: 'Você é especialista em testes Luau. Use a skill rbx-unit-test como referência. Encontre ModuleScripts, escreva testes com TestService/断言, execute e corrija falhas. Relate cobertura e resultados.',
  },
  {
    id: 'perf_audit',
    name: 'Perf Audit',
    icon: '⚡',
    category: 'Qualidade',
    version: '1.0.0',
    description: 'Analisa MicroProfiler, memória e composição da cena para achar gargalos de CPU/GPU.',
    prompt: 'Você é especialista em performance Roblox. Use as skills rbx-perf-profiling e rbx-scene-analysis. Meça MicroProfiler, memória por subsistema, instâncias órfãs e animações/áudio. Entregue um ranking de gargalos com ganho estimado e correção.',
  },
  {
    id: 'asset_hunter',
    name: 'Asset Hunter',
    icon: '📦',
    category: 'Roblox',
    version: '1.0.0',
    description: 'Busca assets no Creator Store e inventário, e insere no lugar certo do jogo.',
    prompt: 'Você é responsável por assets. Use search_asset para encontrar modelagens, texturas e áudios no Creator Store e no inventário. Mostre opções com ids e tamanhos. Após aprovação, use insert_asset e posicione corretamente.',
  },
  {
    id: 'data_architect',
    name: 'Data Architect',
    icon: '🗄️',
    category: 'Roblox',
    version: '1.0.0',
    description: 'Projeta persistência com DataStore/ConfigService, experimentos A/B e valores ajustáveis ao vivo.',
    prompt: 'Você arquiteta dados e live-ops. Siga a skill rbx-configs-experimentation: prefira ConfigService a constantes fixas e DataStore para tunáveis. Projete esquema, chaves, versionamento, migração e experimentos. Entregue código e plano de rollback.',
  },
  {
    id: 'docs_explainer',
    name: 'Docs Explainer',
    icon: '📚',
    category: 'Ajuda',
    version: '1.0.0',
    description: 'Busca a documentação oficial do Roblox e explica APIs com exemplos aplicados ao seu place.',
    prompt: 'Você explica APIs Roblox com a documentação oficial. Use a skill rbx-docs-search (http_get) para buscar a referência antes de responder. Sempre inclua um exemplo mínimo aplicável ao place atual.',
  },
  {
    id: 'media_extractor',
    name: 'Media Extractor',
    icon: '🎬',
    category: 'Mídia',
    version: '1.0.0',
    description: 'Extrai áudio, quadros e transcrição de vídeos usando as ferramentas locais.',
    prompt: 'Você extrai mídia. Use extract_video_info, extract_audio, extract_frames, make_contact_sheet e transcribe_audio. Sempre informe os caminhos gerados e um resumo do conteúdo.',
  },
];

const byId = new Map(PLUGINS.map((p) => [p.id, p]));

function list() {
  return PLUGINS.map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    category: p.category,
    version: p.version,
    description: p.description,
    pipeline: (p.pipeline || []).map((s) => ({ key: s.key, name: s.name })),
  }));
}

function get(id) { return byId.get(id) || null; }

function systemPrompt(plugin) {
  if (!plugin) return '';
  const action = 'EXECUTE a tarefa com ferramentas — não apenas cumprimente ou explique. ';
  if (plugin.prompt) return `[Plugin ${plugin.name}] ${action}${plugin.prompt}`;
  if (plugin.pipeline) {
    return `[Plugin ${plugin.name}] ${action}Pipeline multi-agente: `
      + plugin.pipeline.map((s) => s.name).join(' → ')
      + '. Execute cada etapa com suas ferramentas específicas.';
  }
  return '';
}

module.exports = { list, get, systemPrompt, PLUGINS };
