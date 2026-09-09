/** Types for releaseConfig.mjs. The implementation is plain JS so the EAS
 *  build gate can run it on the image's Node without type-stripping support. */

export type KeyKind =
  | 'publishable'
  | 'legacy-anon'
  | 'legacy-elevated'
  | 'secret'
  | 'unknown'

export interface KeyClassification {
  kind: KeyKind
  /** Decoded `role` claim when the key is a JWT. Classification only. */
  role?: string
}

export interface ReleaseConfig {
  url: string
  key: string
  /** The exact project ref the build is approved for. */
  expectedRef?: string
}

export declare const OFF_ROUTE_THRESHOLD_M: number
export declare function classifyKey(key: string): KeyClassification
export declare function releaseConfigProblem(cfg: ReleaseConfig): string | null
export declare function intelligenceOriginProblem(raw: string | null | undefined): string | null
