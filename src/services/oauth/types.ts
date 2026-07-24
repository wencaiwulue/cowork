export type BillingType = string
export type RateLimitTier = string
export type SubscriptionType = string

export type OAuthTokens = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  [key: string]: any
}

export type OAuthTokenExchangeResponse = OAuthTokens & Record<string, any>
export type OAuthProfileResponse = Record<string, any>
export type UserRolesResponse = Record<string, any>
export type ReferralCampaign = any
export type ReferralEligibilityResponse = any
export type ReferralRedemptionsResponse = any
export type ReferrerRewardInfo = any
