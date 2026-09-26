/**
 * Every support.jamf.com article whose slug is not ASCII: 13 ja and 16 zh-TW,
 * captured 2026-09-26. Every ja and zh-TW article in the sitemap is one of
 * these; the other 2 non-ASCII entries there are zh-TW collections, which the
 * search index leaves out.
 *
 * `listed` is the path as the sitemap spells it, raw. `title` is the one
 * Intercom's own collection page gives the article, which is the only place
 * the site publishes it without a request per article.
 *
 * The whole set rather than a sample, because the question these answer is
 * what a slug keeps of its title, and what it loses — punctuation, the case of
 * an English phrase — is different from one article to the next.
 */
export interface SupportNonAsciiArticle {
  /** Path as support.jamf.com's sitemap lists it, e.g. `/ja/articles/…`. */
  listed: string;
  /** The article's title, as Intercom's collection page renders it. */
  title: string;
}

export const SUPPORT_NON_ASCII_ARTICLES: readonly SupportNonAsciiArticle[] = [
  { listed: '/ja/articles/10631329-self-service-は-jamf-サーバーに関連付けられている必要があります', title: 'Self Service は Jamf サーバーに関連付けられている必要があります' },
  { listed: '/zh-TW/articles/10631329-self-service-必須與-jamf-伺服器相關聯', title: 'Self Service 必須與 Jamf 伺服器相關聯' },
  { listed: '/ja/articles/11014479-jamf-accountでjamf-idを組織に関連付ける', title: 'Jamf AccountでJamf IDを組織に関連付ける' },
  { listed: '/zh-TW/articles/11016566-jamf-pro-推送證書在嘗試續約時下載為-cer-檔案', title: 'Jamf Pro 推送證書在嘗試續約時下載為 .cer 檔案' },
  { listed: '/zh-TW/articles/11016577-無效的證書簽署請求錯誤', title: '無效的證書簽署請求錯誤' },
  { listed: '/ja/articles/11016585-プッシュ証明書の作成に使用されたappleアカウントの確認', title: 'プッシュ証明書の作成に使用されたAppleアカウントの確認' },
  { listed: '/zh-TW/articles/11016585-尋找用於推送證書創建的-apple-帳戶', title: '尋找用於推送證書創建的 Apple 帳戶' },
  { listed: '/zh-TW/articles/11016591-jamf-pro-apns-續約時顯示-403-存取被拒絕', title: 'Jamf Pro APNs 續約時顯示「403 存取被拒絕」' },
  { listed: '/zh-TW/articles/11016594-您上傳了無效的檔案類型-在續約-jamf-pro-推送證書時出現的錯誤訊息', title: '「您上傳了無效的檔案類型」 — 在續約 Jamf Pro 推送證書時出現的錯誤訊息' },
  { listed: '/ja/articles/11016634-jamf-pro-で-mdm-プッシュ通知証明書を更新する', title: 'Jamf Pro で MDM プッシュ通知証明書を更新する' },
  { listed: '/zh-TW/articles/11016634-在-jamf-pro-中更新您的-mdm-推播通知憑證', title: '在 Jamf Pro 中更新您的 MDM 推播通知憑證' },
  { listed: '/ja/articles/11030100-jamf-アカウントチームからのサポートを受ける', title: 'Jamf アカウントチームからのサポートを受ける' },
  { listed: '/zh-TW/articles/11030100-聯絡-jamf-帳戶團隊以取得協助', title: '聯絡 Jamf 帳戶團隊以取得協助' },
  { listed: '/zh-TW/articles/11032693-push-certificate-使用者權限無法在-jamf-pro-中儲存', title: '「Push Certificate 使用者權限無法在 Jamf Pro 中儲存」' },
  { listed: '/ja/articles/11034053-jamf-pro-にアプリが表示されない場合の対処方法', title: 'Jamf Pro にアプリが表示されない場合の対処方法' },
  { listed: '/ja/articles/11155937-jamf-id-の作成', title: 'Jamf ID の作成' },
  { listed: '/zh-TW/articles/11155937-建立-jamf-id', title: '建立 Jamf ID' },
  { listed: '/ja/articles/11156264-jamf-id-のパスワードを変更する', title: 'Jamf ID のパスワードを変更する' },
  { listed: '/zh-TW/articles/11156264-變更您的-jamf-id-密碼', title: '變更您的 Jamf ID 密碼' },
  { listed: '/ja/articles/11645274-jamf-id-で-jamf-アカウントにログインできない場合', title: 'Jamf ID で Jamf アカウントにログインできない場合' },
  { listed: '/zh-TW/articles/11645274-如果您無法使用-jamf-id-登入-jamf-帳戶', title: '如果您無法使用 Jamf ID 登入 Jamf 帳戶' },
  { listed: '/ja/articles/11647778-jamf-id-の多要素認証-mfa-が機能しない場合', title: 'Jamf ID の多要素認証（MFA）が機能しない場合' },
  { listed: '/zh-TW/articles/11647778-jamf-id-多重身份驗證-mfa-無法使用', title: 'Jamf ID 多重身份驗證 (MFA) 無法使用' },
  { listed: '/ja/articles/11657440-id-プロバイダの認証情報で-jamf-アカウントにログインできない場合', title: 'ID プロバイダの認証情報で Jamf アカウントにログインできない場合' },
  { listed: '/zh-TW/articles/11657440-如果您的身份提供者-idp-憑證無法登入-jamf-帳戶', title: '如果您的身份提供者（IdP）憑證無法登入 Jamf 帳戶' },
  { listed: '/ja/articles/11657549-jamf-アカウントへのログイン時に-jamf-auth-we-are-sorry-an-error-occurred-というエラーメッセージが表示される場合', title: 'Jamf アカウントへのログイン時に「jamf-auth We are sorry, an error occurred」というエラーメッセージが表示される場合' },
  { listed: '/zh-TW/articles/11657549-登入-jamf-帳戶時出現-jamf-auth-發生錯誤-請稍後再試-訊息', title: '登入 Jamf 帳戶時出現「jamf-auth 發生錯誤，請稍後再試」訊息' },
  { listed: '/ja/articles/11681388-jamf-account-で-jamf-サポートと連携する', title: 'Jamf Account で Jamf サポートと連携する' },
  { listed: '/zh-TW/articles/11681388-在-jamf-account-與-jamf-支援合作', title: '在 Jamf Account 與 Jamf 支援合作' },
];
