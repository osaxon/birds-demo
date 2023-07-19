import { createTRPCRouter, privateProcedure } from "@/server/api/trpc";
import { Guest, PaymentStatus, ReservationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const newInvoiceInputSchema = z.object({
  returningGuest: z.boolean().default(false).optional(),
  guestId: z.string().optional(),
  firstName: z.string(),
  surname: z.string(),
  email: z.string(),
  reservations: z
    .array(
      z.object({
        // Define the properties of each object in the array
        firstName: z.string(),
        surname: z.string(),
        email: z.string(),
        reservationItemId: z.string(),
        checkIn: z.date(),
        checkOut: z.date(),
        subTotalUSD: z.number().positive().optional(),
        status: z.nativeEnum(ReservationStatus),
      })
    )
    .optional(),
});

const getInvoiceByIdInputSchema = z.object({
  id: z.string(),
});

export const invoiceRouter = createTRPCRouter({
  getOpen: privateProcedure.query(async ({ ctx }) => {
    const invoices = await ctx.prisma.invoice.findMany({
      where: {
        status: {
          not: "CANCELLED",
        },
      },
      include: {
        guest: true,
        reservations: {
          include: {
            reservationItem: true,
            room: true,
          },
        },
      },
    });
    return invoices;
  }),

  getById: privateProcedure
    .input(getInvoiceByIdInputSchema)
    .query(async ({ ctx, input }) => {
      const invoice = await ctx.prisma.invoice.findUnique({
        where: { id: input.id },
        include: { guest: true },
      });

      return invoice;
    }),

  updateStatus: privateProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.nativeEnum(PaymentStatus),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Use extended client to re-calculate totals
      const updatedInvoice = await ctx.xprisma.invoice.update({
        where: { id: input.id },
        data: {
          status: input.status,
          orders: {
            updateMany: {
              where: { status: "UNPAID" },
              data: {
                status: input.status,
              },
            },
          },
          reservations: {
            updateMany: {
              where: {
                invoiceId: input.id,
              },
              data: {
                paymentStatus: input.status,
              },
            },
          },
        },
      });

      return updatedInvoice;
    }),

  create: privateProcedure
    .input(newInvoiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Find the latest invoice number from the database
      const latestInvoice = await ctx.prisma.invoice.findFirst({
        where: { status: { not: "CANCELLED" } },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });

      console.log(latestInvoice?.invoiceNumber);

      let invoiceNumber: number;
      let guest: Guest | undefined = undefined;

      if (latestInvoice) {
        // Increment the latest invoice number by 1
        invoiceNumber = parseInt(latestInvoice.invoiceNumber, 10) + 1;
      } else {
        // Use the starting number if no invoice exists
        invoiceNumber = 1220;
      }

      if (!input.guestId) {
        try {
          guest = await ctx.prisma.guest.create({
            data: {
              firstName: input.firstName,
              surname: input.surname,
              fullName: input.firstName + " " + input.surname,
              email: input.email,
            },
          });
        } catch (error) {
          if ((error as { code: string }).code === "P2002") {
            throw new TRPCError({
              message:
                "A Guest account with this Email already exists. Please choose the existing guest and try again.",
              code: "CONFLICT",
            });
          }
          throw new TRPCError({
            message: "Failed to create the guest.",
            code: "UNPROCESSABLE_CONTENT",
          });
        }
      } else if (input.guestId) {
        guest = (await ctx.prisma.guest.findUnique({
          where: { id: input.guestId },
        })) as Guest;
        if (!guest) {
          throw new TRPCError({
            message: "Failed to find the guest.",
            code: "UNPROCESSABLE_CONTENT",
          });
        }
      }

      if (!guest) {
        throw new TRPCError({
          message: "No guest record to associate with.",
          code: "UNPROCESSABLE_CONTENT",
        });
      }

      const reservationData = input.reservations?.map((res) => ({
        ...res,
        firstName: input.firstName,
        surname: input.surname,
        email: input.email,
        guestId: guest?.id,
      }));

      console.log(reservationData);
      // Format the invoice number with leading zeros
      const formattedInvoiceNumber = invoiceNumber.toString().padStart(6, "0");

      const invoice = await ctx.xprisma.invoice.create({
        data: {
          invoiceNumber: formattedInvoiceNumber,
          reservations: {
            createMany: {
              data: reservationData ?? [],
            },
          },
          customerName: input.firstName + " " + input.surname,
          customerEmail: input.email,
          guest: {
            connect: { id: guest.id },
          },
        },
      });

      return invoice;
    }),
});
