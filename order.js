const { prisma } = require('../db');
const { calcCharge, toNum } = require('../money');
const { SMMProviderClient, mapProviderStatus } = require('../smm-provider');

async function placeOrder({ userId, serviceId, link, quantity, idempotencyKey }) {
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { success: true, orderId: existing.id, status: existing.status, providerOrderId: existing.providerOrderId };
    }
  }

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      provider: true,
      mappings: { where: { status: 'active' }, include: { provider: true }, take: 1 },
    },
  });

  if (!service || service.status !== 'active') {
    return { success: false, error: 'Service not found or disabled', code: 'SERVICE_INVALID' };
  }
  if (quantity < service.min || quantity > service.max) {
    return { success: false, error: `Quantity must be between ${service.min} and ${service.max}`, code: 'QUANTITY_INVALID' };
  }
  if (!link || link.length < 5) {
    return { success: false, error: 'Invalid link', code: 'LINK_INVALID' };
  }

  const price = calcCharge(service.price, quantity);
  const cost = calcCharge(service.cost, quantity);
  const profit = Number((price - cost).toFixed(6));

  let provider = service.provider;
  let providerServiceId = service.providerServiceId;
  const mapping = service.mappings[0];
  if (mapping?.provider?.status === 'active' && mapping.provider.userEnabled !== false) {
    provider = mapping.provider;
    providerServiceId = mapping.providerServiceId;
  }
  if (provider && (provider.status !== 'active' || provider.userEnabled === false)) provider = null;

  let orderId = '';
  try {
    const order = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.status === 'disabled') throw Object.assign(new Error('Account disabled'), { code: 'ACCOUNT_DISABLED' });
      const bal = toNum(user.balance);
      if (bal < price) throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });

      const before = bal;
      const after = Number((before - price).toFixed(6));
      await tx.user.update({ where: { id: userId }, data: { balance: after } });

      const created = await tx.order.create({
        data: {
          userId, serviceId,
          providerId: provider?.id || null,
          link, quantity, price, cost, profit,
          status: 'pending',
          idempotencyKey: idempotencyKey || null,
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          amount: -price,
          balanceBefore: before,
          balanceAfter: after,
          paymentMethod: 'balance',
          status: 'paid',
          type: 'order_charge',
          providerTxnId: `order_${created.id}`,
          description: `Order charge: ${service.name}`,
          paidAt: new Date(),
          metadata: JSON.stringify({ orderId: created.id }),
        },
      });
      return created;
    });
    orderId = order.id;
  } catch (e) {
    return { success: false, error: e.message || 'Order failed', code: e.code || 'ORDER_FAILED' };
  }

  if (provider && providerServiceId) {
    try {
      const client = new SMMProviderClient(provider.apiUrl, provider.apiKey);
      const result = await client.addOrder(providerServiceId, link, quantity);
      if (result.error || !result.order) {
        await refundOrder(orderId, userId, price, result.error || 'Provider rejected');
        return { success: false, orderId, status: 'failed', error: result.error || 'Provider rejected', code: 'PROVIDER_REJECTED' };
      }
      await prisma.order.update({
        where: { id: orderId },
        data: { providerOrderId: String(result.order), status: 'processing' },
      });
      return { success: true, orderId, status: 'processing', providerOrderId: String(result.order) };
    } catch (e) {
      await refundOrder(orderId, userId, price, e.message || 'Provider error');
      return { success: false, orderId, status: 'failed', error: e.message, code: 'PROVIDER_ERROR' };
    }
  }

  return { success: true, orderId, status: 'pending', providerOrderId: null };
}

async function refundOrder(orderId, userId, amount, reason) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const before = toNum(user.balance);
    const after = Number((before + amount).toFixed(6));
    await tx.order.update({ where: { id: orderId }, data: { status: 'failed', errorMessage: String(reason).slice(0, 500) } });
    await tx.user.update({ where: { id: userId }, data: { balance: after } });
    await tx.transaction.create({
      data: {
        userId, amount,
        balanceBefore: before, balanceAfter: after,
        paymentMethod: 'balance', status: 'paid', type: 'order_refund',
        providerTxnId: `refund_${orderId}`,
        description: `Refund: ${reason}`.slice(0, 255),
        paidAt: new Date(),
      },
    });
  });
}

module.exports = { placeOrder, refundOrder };
