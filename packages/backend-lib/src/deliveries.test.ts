import { randomUUID } from "crypto";
import { times } from "remeda";

import { submitBatch } from "./apps";
import config from "./config";
import { searchDeliveries } from "./deliveries";
import prisma from "./prisma";
import {
  BatchItem,
  ChannelType,
  EmailProviderType,
  EventType,
  InternalEventType,
  MessageSendSuccess,
} from "./types";

describe("deliveries", () => {
  describe("searchDeliveries", () => {
    let workspaceId: string;

    beforeEach(async () => {
      const workspace = await prisma().workspace.create({
        data: {
          name: randomUUID(),
        },
      });
      workspaceId = workspace.id;
      await prisma().currentUserEventsTable.create({
        data: {
          workspaceId,
          version: config().defaultUserEventsTableVersion,
        },
      });
    });

    describe("with two different messages from the same journey", () => {
      beforeEach(async () => {
        const userId = randomUUID();
        const now = new Date();

        function generateEvent({
          offset,
          event,
          properties,
          messageId,
        }: {
          offset: number;
          event: string;
          properties: Record<string, unknown>;
          messageId?: string;
        }): BatchItem {
          return {
            userId,
            timestamp: new Date(now.getTime() + offset).toISOString(),
            type: EventType.Track,
            messageId: messageId ?? randomUUID(),
            event,
            properties: {
              ...properties,
            },
          };
        }

        const journeyId = randomUUID();
        const nodeId1 = randomUUID();
        const nodeId2 = randomUUID();
        const nodeId3 = randomUUID();
        const runId = randomUUID();
        const templateId1 = randomUUID();
        const templateId2 = randomUUID();
        const templateId3 = randomUUID();
        const messageId1 = randomUUID();
        const messageId2 = randomUUID();
        const messageId3 = randomUUID();

        const node1Properties = {
          workspaceId,
          journeyId,
          nodeId: nodeId1,
          runId,
          templateId: templateId1,
          messageId: messageId1,
        };

        const node2Properties = {
          workspaceId,
          journeyId,
          nodeId: nodeId2,
          runId,
          templateId: templateId2,
          messageId: messageId2,
        };

        const node3Properties = {
          workspaceId,
          journeyId,
          nodeId: nodeId3,
          runId,
          templateId: templateId3,
          messageId: messageId3,
        };

        const messageSentEvent1: Omit<MessageSendSuccess, "type"> = {
          variant: {
            type: ChannelType.Email,
            from: "test-from@email.com",
            to: "test-to@email.com",
            body: "body1",
            subject: "subject1",
            provider: {
              type: EmailProviderType.Sendgrid,
            },
          },
        };

        const messageSentEvent2: Omit<MessageSendSuccess, "type"> = {
          variant: {
            type: ChannelType.Email,
            from: "test-from@email.com",
            to: "test-to@email.com",
            body: "body2",
            subject: "subject2",
            provider: {
              type: EmailProviderType.Sendgrid,
            },
          },
        };

        // past format form backwards compatibility
        const messageSentEvent3 = {
          channel: ChannelType.Email,
          from: "test-from@email.com",
          to: "test-to@email.com",
          body: "body2",
          subject: "subject2",
        };

        // Submit email events
        const events: BatchItem[] = [
          generateEvent({
            offset: 0,
            event: InternalEventType.MessageSent,
            messageId: messageId1,
            properties: {
              ...node1Properties,
              ...messageSentEvent1,
            },
          }),
          generateEvent({
            offset: 10,
            event: InternalEventType.EmailDelivered,
            properties: node1Properties,
          }),
          generateEvent({
            offset: 20,
            event: InternalEventType.EmailOpened,
            properties: node1Properties,
          }),
          generateEvent({
            offset: 10,
            event: InternalEventType.MessageSent,
            messageId: messageId2,
            properties: {
              ...node2Properties,
              ...messageSentEvent2,
            },
          }),
          generateEvent({
            offset: 20,
            event: InternalEventType.EmailBounced,
            properties: node2Properties,
          }),
          // check that backwards compatible
          generateEvent({
            offset: 40,
            event: InternalEventType.MessageSent,
            messageId: messageId3,
            properties: {
              ...node3Properties,
              ...messageSentEvent3,
            },
          }),
        ];

        await submitBatch({
          workspaceId,
          data: {
            batch: events,
          },
        });
      });

      it("returns the correct email events", async () => {
        const deliveries = await searchDeliveries({ workspaceId });
        expect(deliveries.items).toHaveLength(3);
        expect(deliveries.items.map((d) => d.status)).toEqual([
          InternalEventType.MessageSent,
          InternalEventType.EmailBounced,
          InternalEventType.EmailOpened,
        ]);
      });
    });

    describe("when filtering by user id", () => {
      let userId: string;
      beforeEach(async () => {
        userId = randomUUID();

        const messageSentEvent: Omit<MessageSendSuccess, "type"> = {
          variant: {
            type: ChannelType.Email,
            from: "test-from@email.com",
            to: "test-to@email.com",
            body: "body",
            subject: "subject",
            provider: {
              type: EmailProviderType.Sendgrid,
            },
          },
        };
        const events: BatchItem[] = [
          {
            userId,
            timestamp: new Date().toISOString(),
            type: EventType.Track,
            messageId: randomUUID(),
            event: InternalEventType.MessageSent,
            properties: {
              workspaceId,
              journeyId: randomUUID(),
              nodeId: randomUUID(),
              runId: randomUUID(),
              templateId: randomUUID(),
              messageId: randomUUID(),
              ...messageSentEvent,
            },
          },
          {
            userId: randomUUID(),
            timestamp: new Date().toISOString(),
            type: EventType.Track,
            messageId: randomUUID(),
            event: InternalEventType.MessageSent,
            properties: {
              workspaceId,
              journeyId: randomUUID(),
              nodeId: randomUUID(),
              runId: randomUUID(),
              templateId: randomUUID(),
              messageId: randomUUID(),
              ...messageSentEvent,
            },
          },
        ];

        await submitBatch({
          workspaceId,
          data: {
            batch: events,
          },
        });
      });
      it("returns the correct number of items", async () => {
        const deliveries = await searchDeliveries({
          workspaceId,
          userId,
          limit: 10,
        });
        expect(deliveries.items).toHaveLength(1);
        expect(deliveries.items[0]?.userId).toEqual(userId);
      });
    });

    describe("when filtering by journey id", () => {
      let journeyId: string;
      beforeEach(async () => {
        journeyId = randomUUID();

        const messageSentEvent: Omit<MessageSendSuccess, "type"> = {
          variant: {
            type: ChannelType.Email,
            from: "test-from@email.com",
            to: "test-to@email.com",
            body: "body",
            subject: "subject",
            provider: {
              type: EmailProviderType.Sendgrid,
            },
          },
        };
        const events: BatchItem[] = [
          {
            userId: randomUUID(),
            timestamp: new Date().toISOString(),
            type: EventType.Track,
            messageId: randomUUID(),
            event: InternalEventType.MessageSent,
            properties: {
              workspaceId,
              journeyId,
              nodeId: randomUUID(),
              runId: randomUUID(),
              templateId: randomUUID(),
              messageId: randomUUID(),
              ...messageSentEvent,
            },
          },
          {
            userId: randomUUID(),
            timestamp: new Date().toISOString(),
            type: EventType.Track,
            messageId: randomUUID(),
            event: InternalEventType.MessageSent,
            properties: {
              workspaceId,
              journeyId: randomUUID(),
              nodeId: randomUUID(),
              runId: randomUUID(),
              templateId: randomUUID(),
              messageId: randomUUID(),
              ...messageSentEvent,
            },
          },
        ];

        await submitBatch({
          workspaceId,
          data: {
            batch: events,
          },
        });
      });
      it("returns the correct number of items", async () => {
        const deliveries = await searchDeliveries({
          workspaceId,
          journeyId,
          limit: 10,
        });
        expect(deliveries.items).toHaveLength(1);
        expect(deliveries.items[0]?.journeyId).toEqual(journeyId);
      });
    });

    describe("when paginating", () => {
      beforeEach(async () => {
        const events: BatchItem[] = times(15, () => {
          const messageSentEvent: Omit<MessageSendSuccess, "type"> = {
            variant: {
              type: ChannelType.Email,
              from: "test-from@email.com",
              to: "test-to@email.com",
              body: "body",
              subject: "subject",
              provider: {
                type: EmailProviderType.Sendgrid,
              },
            },
          };
          return {
            userId: randomUUID(),
            timestamp: new Date().toISOString(),
            type: EventType.Track,
            messageId: randomUUID(),
            event: InternalEventType.MessageSent,
            properties: {
              workspaceId,
              journeyId: randomUUID(),
              nodeId: randomUUID(),
              runId: randomUUID(),
              templateId: randomUUID(),
              messageId: randomUUID(),
              ...messageSentEvent,
            },
          };
        });
        await submitBatch({
          workspaceId,
          data: {
            batch: events,
          },
        });
      });
      it("returns the correct number of items", async () => {
        let deliveries = await searchDeliveries({
          workspaceId,
          limit: 10,
        });
        if (!deliveries.cursor) {
          throw new Error("cursor is missing");
        }
        expect(deliveries.items).toHaveLength(10);
        deliveries = await searchDeliveries({
          workspaceId,
          limit: 10,
          cursor: deliveries.cursor,
        });
        expect(deliveries.items).toHaveLength(5);
        expect(deliveries.cursor).toBeUndefined();
      });
    });
  });
});
