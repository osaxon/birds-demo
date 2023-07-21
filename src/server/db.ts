import { PrismaClient, Reservation } from "@prisma/client";
import { env } from "@/env.mjs";
import { TRPCError } from "@trpc/server";
import { Decimal } from "@prisma/client/runtime/library";
import dayjs from "dayjs";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

/*
 * This extended client ensures the outstanding balance on an invoice is correct
 * by executing a function which aggregates outstanding reservations and orders
 * on an invoice whenever a reservation, order or invoice is created or updated.
 */
export const xprisma = prisma.$extends({
  query: {
    reservation: {
      create: async ({ model, operation, args, query }) => {
        const reservation = await prisma.reservation.create(args);
        if (!reservation) {
          throw new Error("Error creating reservation");
        }
        console.log(reservation.invoiceId);
        if (reservation.invoiceId) {
          console.log("updated the total");
          await updateInvoiceTotal(reservation.invoiceId);
        }
        return reservation;
      },
      update: async ({ model, operation, args, query }) => {
        const { data } = args;
        const { paymentStatus, invoiceId: newInvoiceId } = data;

        // Fetch the reservation's current data
        const currentReservation = await prisma.reservation.findUnique({
          where: { id: args.where.id },
          select: { invoiceId: true },
        });

        console.log(
          currentReservation && currentReservation.invoiceId === newInvoiceId
        );

        const updatedReservation = await query(args);

        // If paymentStatus is updated
        if (updatedReservation && paymentStatus) {
          const previousReservation = await prisma.reservation.findUnique({
            where: { id: args.where.id },
            select: { paymentStatus: true, invoiceId: true },
          });

          if (
            previousReservation &&
            previousReservation.paymentStatus !== paymentStatus
          ) {
            // Payment status has been changed, update the invoice
            const { invoiceId } = previousReservation;
            if (invoiceId) {
              await updateInvoiceTotal(invoiceId);
            }
          }
        }

        // If invoiceId is updated
        if (
          updatedReservation &&
          newInvoiceId &&
          currentReservation &&
          currentReservation.invoiceId !== newInvoiceId
        ) {
          console.log("invoice id changed");

          const previousInvoiceId = currentReservation.invoiceId;
          // Update the previous invoice total
          if (previousInvoiceId) {
            console.log(`Updating previous invoice ${previousInvoiceId}`);
            await updateInvoiceTotal(previousInvoiceId);
          }

          // Update the new invoice total
          if (typeof newInvoiceId === "string") {
            console.log(`Updating new invoice ${newInvoiceId}`);
            await updateInvoiceTotal(newInvoiceId);
          }
        }

        return updatedReservation;
      },
    },
    invoice: {
      create: async ({ model, operation, args, query }) => {
        const invoice = await prisma.invoice.create(args);

        if (!invoice) {
          throw new Error("Error creating invoice");
        }
        await updateInvoiceTotal(invoice.id);
        return invoice;
      },
      update: async ({ model, operation, args, query }) => {
        const { data } = args;
        const { status } = data;
        let updatedInvoice;

        if (status === "CANCELLED") {
          const newNumber = await generateCancelledInvoiceNumber();
          console.log(newNumber);

          updatedInvoice = await query(args);

          if (updatedInvoice) {
            updatedInvoice = await prisma.invoice.update({
              where: { id: updatedInvoice.id },
              data: {
                invoiceNumber: newNumber,
              },
            });
          }
        }

        return updatedInvoice;
      },
    },
    order: {
      create: async ({ model, operation, args, query }) => {
        const order = await prisma.order.create({
          ...args,
          data: {
            ...args.data,
            createdDate: dayjs(new Date()).startOf("day").toDate(),
          },
        });
        if (!order) {
          throw new Error("Error creating order");
        }
        console.log(order.invoiceId);
        if (order.invoiceId) {
          console.log("updated the total");
          await updateInvoiceTotal(order.invoiceId);
        }
        return order;
      },
      update: async ({ model, operation, args, query }) => {
        const { data } = args;
        const { status } = data;

        const updatedOrder = await query(args);

        // If status is updated
        if (status && updatedOrder && updatedOrder.invoiceId) {
          await updateInvoiceTotal(updatedOrder.invoiceId);
        }

        return updatedOrder;
      },
    },
  },
});

const updateInvoiceTotal = async (invoiceId: string) => {
  console.log("updating invoice total function");

  try {
    // Calculate the aggregated totals for unpaid reservations and orders
    const aggregatedOutstandingReservations =
      await prisma.reservation.aggregate({
        where: {
          invoiceId: invoiceId,
          paymentStatus: "UNPAID",
        },
        _sum: {
          subTotalUSD: true,
        },
      });

    const aggregatedOutstandingOrders = await prisma.order.aggregate({
      where: {
        invoiceId: invoiceId,
        status: "UNPAID",
      },
      _sum: {
        subTotalUSD: true,
      },
    });

    // Calculate the new total
    let newBalance = new Decimal(0);
    let newTotal = new Decimal(0);

    if (aggregatedOutstandingReservations._sum?.subTotalUSD) {
      newBalance = newBalance.add(
        aggregatedOutstandingReservations._sum.subTotalUSD
      );
    }

    if (aggregatedOutstandingOrders._sum?.subTotalUSD) {
      newBalance = newBalance.add(aggregatedOutstandingOrders._sum.subTotalUSD);
    }

    console.log("new total:", newBalance);

    // Calculate the total minus any cancelled
    const aggregatedTotalReservations = await prisma.reservation.aggregate({
      where: {
        invoiceId: invoiceId,
        paymentStatus: { not: "CANCELLED" },
      },
      _sum: {
        subTotalUSD: true,
      },
    });

    // Add everything which isn't cancelled
    const aggregatedTotalOrders = await prisma.order.aggregate({
      where: {
        invoiceId: invoiceId,
        status: { not: "CANCELLED" },
      },
      _sum: {
        subTotalUSD: true,
      },
    });

    if (aggregatedTotalReservations._sum?.subTotalUSD) {
      newTotal = newTotal.add(aggregatedTotalReservations._sum.subTotalUSD);
    }

    if (aggregatedTotalOrders._sum?.subTotalUSD) {
      newTotal = newTotal.add(aggregatedTotalOrders._sum.subTotalUSD);
    }

    console.log("total:", newTotal);

    // Update the invoice with the new total and remaining balance
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        totalUSD: newTotal,
        remainingBalanceUSD: newBalance,
      },
    });
  } catch (error) {
    console.error("Error updating invoice total:", error);
    throw new TRPCError({
      message: "Error updating invoice total.",
      code: "INTERNAL_SERVER_ERROR",
    });
  }
};

async function generateCancelledInvoiceNumber(): Promise<string> {
  let newInvoiceNumber;

  const latestCancelled = await prisma.invoice.findFirst({
    where: { status: "CANCELLED" },
    orderBy: { invoiceNumber: "desc" },
  });
  console.log(latestCancelled);
  if (latestCancelled) {
    // Increment the latest invoice number by 1
    newInvoiceNumber = parseInt(latestCancelled.invoiceNumber, 10) + 1;
  } else {
    // Use the starting number if no invoice exists
    newInvoiceNumber = 9000;
  }
  // Logic to generate the new invoice number when an invoice is cancelled
  console.info("Invoice cancelled - changing invoice number");
  console.log(newInvoiceNumber);
  return newInvoiceNumber.toString().padStart(6, "0");
}

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
