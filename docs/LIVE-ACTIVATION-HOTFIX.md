# 雲端同步開通：最小前端修補

本分支從目前已核對的線上前端 commit `bfe8913dce589b41dae920e0c6856399dac26376` 建立，只處理新買家序號開通與既有帳號登入。

- 新帳號：從 Gumroad 購買完成頁／收據取得 License Key，填序號、相同購買 Email 與自設至少 8 碼密碼。
- 未填序號不能送出，也不能只憑 Email 設定新帳號密碼。所有非空代碼交給正式 activate 後端驗證，沒有共用邀請碼的客戶端捷徑。
- 既有帳號／其他裝置：只以原 Email 和密碼登入，不嘗試公開 signup，也不以空序號重試開戶。
- 教學頁、手冊與商品說明保留原售價，說明同一帳號跨裝置使用；找不到序號請聯絡客服，不重複付款、不提供密碼。

正式後端需驗證 License 與購買 Email，拒絕 test、退款及停用序號，並配置正確 GUMROAD_PRODUCT_ID；這些是部署前端的相容前提，不由這份前端 commit 實作或證明。

沒有移入完整候選版的同步 CAS、ownerWatch／frameGuard、storage／备份還原、quota、password recovery、IAP 原型、CI 或依賴更新。現有登入／同步之外的流程保持本分支基準版本；不能把本次開通修補當成整個安全候選版已上線。

驗證請使用此分支自己的 npm lock：`npm ci`、`npm test`、`npm run lint`、`npm run build`，並核對新圖解頁與圖片存在。測試包括錯誤帳密不呼叫 signup／白名單、空序號不送 API、舊共用代碼不繞後端，以及實際 Settings 表單的必要欄位、等同步完成才報成功、直接登入不重新送序號。

`public/sw.js` 保留基準的 navigation network-first。正式驗收須讓兩個測試 context 連網重新載入、確認實際載入新 build 的 asset hash，不清除使用者 localStorage。這份 commit 本身沒有部署，也沒有替買家設定密碼、使用買家序號或讀取日記。

原 lock 的依賴漏洞仍是獨立 release gate；本次沒有 audit=0 的宣稱。正式部署前由維護者決定與驗證必要依賴修補、前端版本及後端 readback，再以專用 QA 身分／本人操作做開通與跨裝置同步驗收。
