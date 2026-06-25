import { ParseError } from '../errors';
import type { ParsedSource, SourceFile, SourceParser } from './source-parser';

export class CompositeSourceParser implements SourceParser {
  constructor(private readonly parsers: SourceParser[]) {}

  supports(file: SourceFile): boolean {
    return this.parsers.some((parser) => parser.supports(file));
  }

  async parse(file: SourceFile): Promise<ParsedSource> {
    const parser = this.parsers.find((candidate) => candidate.supports(file));
    if (!parser) {
      throw new ParseError('PARSE_UNSUPPORTED', `不支持的文件类型：${file.name}`);
    }
    return parser.parse(file);
  }
}
