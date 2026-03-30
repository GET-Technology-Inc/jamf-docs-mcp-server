/**
 * Node.js metadata store implementation
 *
 * Wraps the core metadata functions to implement the MetadataStore interface.
 * Requires a ServerContext to be provided at construction time.
 */

import type { MetadataStore, ProductMetadata, TopicMetadata, TocData } from '../../core/services/interfaces/index.js';
import type { ServerContext } from '../../core/types/context.js';
import {
  getProductsMetadata,
  getTopicsMetadata,
  getBundleIdForVersion as coreBundleIdForVersion,
  getAvailableVersions as coreGetAvailableVersions,
} from '../../core/services/metadata.js';
import { fetchTableOfContents } from '../../core/services/scraper.js';
import type { ProductId } from '../../core/constants.js';

export class NodeMetadataStore implements MetadataStore {
  private readonly ctx: ServerContext;

  constructor(ctx: ServerContext) {
    this.ctx = ctx;
  }

  async getProducts(): Promise<ProductMetadata[]> {
    return getProductsMetadata(this.ctx);
  }

  async getTopics(): Promise<TopicMetadata[]> {
    return getTopicsMetadata(this.ctx);
  }

  async getToc(productId: string, _bundleId: string): Promise<TocData> {
    const result = await fetchTableOfContents(this.ctx, productId as ProductId, 'current', {});
    return {
      entries: result.toc,
      product: productId,
      version: 'current',
    };
  }

  async getBundleIdForVersion(productId: string, version?: string): Promise<string | null> {
    return coreBundleIdForVersion(this.ctx, productId as ProductId, version);
  }

  async getAvailableVersions(productId: string): Promise<string[]> {
    return coreGetAvailableVersions(this.ctx, productId as ProductId);
  }
}
