import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import OverviewView from '../../src/components/OverviewView';
import i18n from '../../src/i18n';
import type { CurrencyPair, HKStockCode } from '../../src/types';
import { installElectronAPI, makeRate, makeStock, renderWithProviders } from '../helpers';

const RATES: Partial<Record<CurrencyPair, number>> = {
  USDCNY: 6.7208,
  JPYCNY: 0.042177,
  EURCNY: 7.8324,
};

const STOCKS: Record<string, string> = {
  '00700': '腾讯控股',
  '09988': '阿里巴巴-W',
};

function renderOverview() {
  const onSelectPair = vi.fn();
  const onSelectStock = vi.fn();
  const utils = renderWithProviders(
    <OverviewView onSelectPair={onSelectPair} onSelectStock={onSelectStock} />,
  );
  return { onSelectPair, onSelectStock, ...utils };
}

beforeEach(async () => {
  await i18n.changeLanguage('zh');
});

describe('OverviewView', () => {
  it('renders pair cards with rates from the API', async () => {
    const api = installElectronAPI();
    api.getExchangeRate.mockImplementation((code: CurrencyPair) =>
      Promise.resolve(makeRate({ currentRate: RATES[code] ?? 1, name: code })));
    renderOverview();

    expect(await screen.findByText('美元/人民币')).toBeTruthy();
    expect(screen.getAllByText('6.7208').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0.04218')).toBeTruthy();
    expect(screen.getByText('美元指数 DXY')).toBeTruthy();
  });

  it('renders stock cards and skips failed pairs', async () => {
    const api = installElectronAPI();
    api.getExchangeRate.mockImplementation((code: CurrencyPair) =>
      code === 'JPYCNY' ? Promise.reject(new Error('boom')) : Promise.resolve(makeRate({ currentRate: RATES[code] ?? 1 })));
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: STOCKS[code] ?? code })));
    renderOverview();

    expect(await screen.findByText('腾讯控股')).toBeTruthy();
    expect(screen.queryByText('日元/人民币')).toBeNull();
    expect(screen.getByText('美元/人民币')).toBeTruthy();
  });

  it('navigates to the pair detail on card click', async () => {
    const api = installElectronAPI();
    api.getHKStockMinute.mockImplementation((code: HKStockCode) =>
      Promise.resolve(makeStock({ code, name: STOCKS[code] ?? code })));
    const { onSelectPair, onSelectStock } = renderOverview();

    const pairCard = (await screen.findByText('美元/人民币')).closest('.pair-card');
    fireEvent.click(pairCard!);
    expect(onSelectPair).toHaveBeenCalledWith('USDCNY');

    const stockCard = (await screen.findByText('腾讯控股')).closest('.stock-card');
    fireEvent.click(stockCard!);
    expect(onSelectStock).toHaveBeenCalledWith('00700');
  });

  it('shows update timestamps after loading', async () => {
    installElectronAPI();
    renderOverview();
    const labels = await screen.findAllByText(/更新于 \d{2}:\d{2}:\d{2}/);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});
