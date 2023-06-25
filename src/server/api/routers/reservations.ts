import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import dayjs from "dayjs";
import { getRateTotal, getDurationOfStay } from "@/lib/utils";
import {
  createTRPCRouter,
  publicProcedure,
  privateProcedure,
} from "@/server/api/trpc";

import {
  type Prisma,
  ReservationStatus,
  RoomStatus,
  ReservationItem,
  Reservation,
  Invoice,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime";

type ReservationWithRoom = Prisma.ReservationGetPayload<{
  include: { room: true };
}>;

const addClerkUserData = async (reservations: ReservationWithRoom[]) => {
  // Extract all user IDs from reservations data and filter out null values
  const userIds = reservations
    .map((reservation) => reservation.userId)
    .filter((userId): userId is string => userId !== null);

  // Fetch user data for the extracted IDs
  const users = await clerkClient.users.getUserList({
    userId: userIds,
    limit: 100,
  });

  // Map user data to corresponding reservation
  return reservations.map((reservation) => {
    const user = users.find((user) => user.id === reservation.userId);

    if (!user || !user.username)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No user found",
      });

    return {
      ...reservation,
      user: {
        ...user,
        username: user.username,
        firstName: user.firstName,
      },
    };
  });
};

export const reservationsRouter = createTRPCRouter({
  getAll: privateProcedure.query(async ({ ctx }) => {
    const reservations = await ctx.prisma.reservation.findMany({
      take: 100,
    });
    return reservations;
  }),

  getReservationItems: privateProcedure.query(async ({ ctx }) => {
    const resItems = await ctx.prisma.reservationItem.findMany();
    return resItems;
  }),

  createReservation: privateProcedure
    .input(
      z.object({
        guestName: z.string(),
        checkIn: z.date(),
        checkOut: z.date(),
        guestId: z.string().optional(),
        guestEmail: z.string().email(),
        resItemId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let reservation;

      const durationInDays = getDurationOfStay(input.checkIn, input.checkOut);
      const resItem = await ctx.prisma.reservationItem.findUnique({
        where: { id: input.resItemId },
      });

      if (!resItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reservation Option not found.",
        });
      }

      const rateTotal = getRateTotal(durationInDays, resItem);

      // If we already have the Guest details stored
      if (input.guestId) {
        reservation = await ctx.prisma.reservation.create({
          data: {
            guestName: input.guestName,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            guest: {
              connect: { id: input.guestId },
            },
            reservationItem: {
              connect: { id: input.resItemId },
            },
            subTotalUSD: rateTotal.value,
            guestEmail: input.guestEmail,
          },
          include: {
            room: true,
            guest: true,
            reservationItem: true,
            invoice: {
              include: {
                reservation: true,
              },
            },
          },
        });
        // For new guests.
      } else {
        reservation = await ctx.prisma.reservation.create({
          data: {
            guestName: input.guestName,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            reservationItem: {
              connect: { id: input.resItemId },
            },
            subTotalUSD: rateTotal.value,
            guestEmail: input.guestEmail,
          },
          include: {
            room: true,
            reservationItem: true,
            invoice: {
              include: {
                reservation: true,
              },
            },
          },
        });
      }

      return reservation;
    }),

  getRoomReservations: privateProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reservations = await ctx.prisma.reservation.findMany({
        where: {
          roomId: input.roomId,
          checkIn: {
            gte: new Date(),
          },
        },
        include: {
          room: true,
        },
        take: 100,
      });
      const withUserData = await addClerkUserData(reservations);
      return withUserData;
    }),

  getByID: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const reservation = await ctx.prisma.reservation.findUnique({
        where: { id: input.id },
        include: {
          room: true,
          orders: {
            include: {
              items: {
                include: {
                  item: true,
                },
              },
            },
          },
          guest: {
            include: {
              orders: {
                include: {
                  items: true,
                },
              },
              invoices: {
                include: {
                  lineItems: true,
                },
              },
            },
          },
        },
      });
      return reservation;
    }),

  checkIn: privateProcedure
    .input(
      z.object({
        reservationId: z.string(),
        guestName: z.string(),
        firstName: z.string(),
        checkIn: z.date(),
        checkOut: z.date(),
        surname: z.string(),
        guestEmail: z.string().email(),
        roomId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const durationInDays = getDurationOfStay(input.checkIn, input.checkOut);

      // Find the latest invoice number from the database
      const latestInvoice = await ctx.prisma.invoice.findFirst({
        orderBy: { invoiceNumber: "desc" },
      });

      let invoiceNumber: number;

      if (latestInvoice) {
        // Increment the latest invoice number by 1
        invoiceNumber = parseInt(latestInvoice.invoiceNumber, 10) + 1;
      } else {
        // Use the starting number if no invoice exists
        invoiceNumber = 2000;
      }

      // Format the invoice number with leading zeros
      const formattedInvoiceNumber = invoiceNumber.toString().padStart(6, "0");

      const reservation: Prisma.ReservationGetPayload<{
        include: { reservationItem: true };
      }> = await ctx.prisma.reservation.update({
        where: { id: input.reservationId },
        data: {
          status: ReservationStatus.CHECKED_IN,

          guest: {
            create: {
              email: input.guestEmail,
              firstName: input.firstName,
              surname: input.surname,
              currentReservationId: input.reservationId,
            },
          },

          room: {
            connect: {
              id: input.roomId,
            },
            update: {
              status: RoomStatus.OCCUPIED,
            },
          },
        },
        include: {
          room: true,
          reservationItem: true,
          guest: true,
          invoice: {
            include: {
              lineItems: true,
            },
          },
        },
      });

      if (!reservation) {
        throw new TRPCError({
          message: "Failed to update the reservation record.",
          code: "UNPROCESSABLE_CONTENT",
        });
      }

      if (!reservation.guestId) {
        throw new TRPCError({
          message: "Failed to create the Guest rexcord",
          code: "UNPROCESSABLE_CONTENT",
        });
      }

      const resItem: ReservationItem | null = reservation.reservationItem;

      if (!resItem) {
        throw new TRPCError({
          message: "Reservation item not found.",
          code: "UNPROCESSABLE_CONTENT",
        });
      }

      // Calculate rate total based on duration and reservation item
      const rateTotal = getRateTotal(durationInDays, resItem);

      const invoice = await ctx.prisma.invoice.create({
        data: {
          invoiceNumber: formattedInvoiceNumber,
          customerEmail: input.guestEmail,
          customerName: input.firstName,
          reservation: {
            connect: { id: reservation.id },
          },
          guest: {
            connect: {
              id: reservation.guestId,
            },
          },

          // -- START -- DON'T ADD THIS YET AS CHECKOUT COULD CHANGE
          //   lineItems: {
          //     create: {
          //       description: rateTotal.desc,
          //       qty: durationInDays,
          //       unitPriceUSD: rateTotal.value / durationInDays,
          //       subTotalUSD: rateTotal.value,
          //     },
          //   },
          //   totalUSD: rateTotal.value,
          // -- END --
        },
        include: {
          lineItems: true,
          reservation: true,
        },
      });

      if (!invoice) {
        throw new TRPCError({
          message: "Failed to generate invoice.",
          code: "NOT_FOUND",
        });
      }

      // TODO update reservation with InvoiceID string value

      return reservation;
    }),

  calculateSubTotal: privateProcedure
    .input(
      z.object({
        reservationId: z.string(),
        checkIn: z.date(),
        checkOut: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const totalDays = dayjs(input.checkOut).diff(dayjs(input.checkIn), "day");

      // Fetch the Reservation and include the associated Room
      const reservation = await ctx.prisma.reservation.findUnique({
        where: { id: input.reservationId },
        include: { room: true },
      });

      if (!reservation) {
        throw new Error("Reservation not found");
      }

      const dailyRate = reservation.room?.dailyRateUSD?.toString();
      const subTotal = dailyRate ? parseFloat(dailyRate) * totalDays : 0;

      const updatedReservation = await ctx.prisma.reservation.update({
        where: { id: input.reservationId },
        data: {
          subTotalUSD: new Decimal(subTotal),
          status: ReservationStatus.FINAL_BILL,
        },
      });

      return updatedReservation;
    }),

  checkOut: privateProcedure
    .input(
      z.object({
        reservationId: z.string(),
        roomId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const reservation = await ctx.prisma.reservation.update({
        where: { id: input.reservationId },
        data: {
          status: ReservationStatus.CHECKED_OUT,

          guest: {
            update: { currentReservationId: "" },
          },

          room: {
            update: {
              status: RoomStatus.VACANT,
            },
          },
        },
        include: {
          room: true,
        },
      });
      return reservation;
    }),

  getActiveReservations: privateProcedure.query(async ({ ctx }) => {
    const reservations = await ctx.prisma.reservation.findMany({
      where: {
        status: {
          in: ["CHECKED_IN", "CONFIRMED", "FINAL_BILL"],
        },
      },
      include: {
        room: true,
        guest: true,
        invoice: {
          include: {
            lineItems: true,
          },
        },
      },
    });
    return reservations;
  }),
});
