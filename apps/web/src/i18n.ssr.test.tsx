import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider, LanguageSelect, LOCALE_NAMES, SUPPORTED_LOCALES, useI18n } from './i18n'

function LocaleProbe() {
  const { locale, t } = useI18n()
  return (
    <main data-locale={locale}>
      <LanguageSelect />
      <h1>{t('hero.title')}</h1>
      <p>{t('doctrine.exactText')}</p>
    </main>
  )
}

describe('locale provider rendering', () => {
  it('renders every allowlisted language in the selector', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="ar"><LocaleProbe /></I18nProvider>,
    )

    expect(html).toContain('data-locale="ar"')
    expect(html).toContain('<option value="ar" selected="">العربية</option>')
    for (const locale of SUPPORTED_LOCALES) {
      expect(html).toContain(`value="${locale}"`)
      expect(html).toContain(LOCALE_NAMES[locale])
    }
    expect((html.match(/<option /g) ?? [])).toHaveLength(11)
    expect(html).toContain('لا تحفظ الرقعة.')
  })

  it('renders the reviewed Simplified Chinese interface catalog', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="zh-Hans"><LocaleProbe /></I18nProvider>,
    )

    expect(html).toContain('data-locale="zh-Hans"')
    expect(html).toContain('<option value="zh-Hans" selected="">简体中文</option>')
    expect(html).toContain('不要死记棋盘。')
    expect(html).toContain('规则代码负责气、合法性、提子、劫、计分与历史。')
  })

  it('renders the reviewed Japanese interface catalog', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="ja"><LocaleProbe /></I18nProvider>,
    )

    expect(html).toContain('data-locale="ja"')
    expect(html).toContain('<option value="ja" selected="">日本語</option>')
    expect(html).toContain('盤を丸暗記しない。')
    expect(html).toContain('ルールコードが、ダメ、着手の可否、取り、コウ、得点計算、履歴を管理します。')
  })
})
