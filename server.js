import express, { json } from "express";
import { config } from "dotenv";
import Queue from "bull";
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import { LocciScheduler } from "@locci-scheduler/client";

(async () => {
  config();

  // Redis connection options
  const redisOptions = {
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
    },
  };

  // Initialize Locci Scheduler
  const scheduler = new LocciScheduler({
    baseUrl: process.env.LOCCI_SCHEDULER_HOST || "http://localhost:9696",
    apiToken: process.env.LOCCI_API_TOKEN,
  });

  // Create BullMQ queues for different AgTech operations
  const queuesList = [
    "iot-sensors",      // IoT sensor data processing
    "irrigation",       // Irrigation control commands
    "market-data",      // Market price updates
    "maintenance",      // Equipment maintenance alerts
    "notifications"     // SMS/USSD notifications via Africa's Talking
  ];

  // Setup Bull Board for monitoring
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  const queues = queuesList
    .map((qs) => new Queue(qs, redisOptions))
    .map((q) => new BullAdapter(q));

  const { addQueue } = createBullBoard({
    queues,
    serverAdapter: serverAdapter,
  });

  // Get actual queue instances for job processing
  const iotSensorQueue = new Queue("iot-sensors", redisOptions);
  const irrigationQueue = new Queue("irrigation", redisOptions);
  const marketDataQueue = new Queue("market-data", redisOptions);
  const maintenanceQueue = new Queue("maintenance", redisOptions);
  const notificationQueue = new Queue("notifications", redisOptions);

  const app = express();
  app.use(json());
  app.use("/admin/queues", serverAdapter.getRouter());

  // ===========================================
  // WEBHOOK ENDPOINTS FOR LOCCI SCHEDULER
  // ===========================================

  // IoT Sensor Data Collection Webhook
  app.post("/webhooks/collect-sensor-data", async (req, res) => {
    try {
      console.log("🌱 Locci triggered IoT sensor data collection");
      
      // Add jobs to BullMQ for each sensor type
      await iotSensorQueue.add("collect-soil-moisture", {
        farmId: "farm-001",
        sensorType: "soil_moisture",
        timestamp: new Date().toISOString()
      });

      await iotSensorQueue.add("collect-weather-data", {
        farmId: "farm-001", 
        sensorType: "weather",
        timestamp: new Date().toISOString()
      });

      await iotSensorQueue.add("collect-crop-health", {
        farmId: "farm-001",
        sensorType: "crop_health", 
        timestamp: new Date().toISOString()
      });

      res.json({ status: "success", message: "IoT data collection jobs queued" });
    } catch (error) {
      console.error("Sensor collection error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Smart Irrigation Control Webhook
  app.post("/webhooks/irrigation-check", async (req, res) => {
    try {
      console.log("💧 Locci triggered irrigation assessment");
      
      // Check soil moisture and trigger irrigation if needed
      await irrigationQueue.add("assess-irrigation-needs", {
        farmId: "farm-001",
        zones: ["zone-a", "zone-b", "zone-c"],
        timestamp: new Date().toISOString()
      });

      res.json({ status: "success", message: "Irrigation assessment queued" });
    } catch (error) {
      console.error("Irrigation check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Market Price Monitoring Webhook  
  app.post("/webhooks/market-prices", async (req, res) => {
    try {
      console.log("📈 Locci triggered market price update");
      
      await marketDataQueue.add("fetch-market-prices", {
        crops: ["maize", "beans", "tomatoes"],
        markets: ["nairobi", "mombasa", "kisumu"],
        timestamp: new Date().toISOString()
      });

      res.json({ status: "success", message: "Market price update queued" });
    } catch (error) {
      console.error("Market price error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Equipment Maintenance Check Webhook
  app.post("/webhooks/maintenance-check", async (req, res) => {
    try {
      console.log("🔧 Locci triggered maintenance check");
      
      await maintenanceQueue.add("check-equipment-status", {
        farmId: "farm-001",
        equipment: ["irrigation-pumps", "sensors", "drones"],
        timestamp: new Date().toISOString()
      });

      res.json({ status: "success", message: "Maintenance check queued" });
    } catch (error) {
      console.error("Maintenance check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===========================================
  // BULLMQ JOB PROCESSORS
  // ===========================================

  // IoT Sensor Data Processors
  iotSensorQueue.process("collect-soil-moisture", async (job) => {
    const { farmId, sensorType } = job.data;
    console.log(`📊 Processing ${sensorType} data for ${farmId}`);
    
    // Simulate sensor data collection
    const moistureLevel = Math.random() * 100;
    
    // If moisture is low, trigger irrigation
    if (moistureLevel < 30) {
      await irrigationQueue.add("start-irrigation", {
        farmId,
        zone: "zone-a", 
        reason: "low_soil_moisture",
        moistureLevel,
        timestamp: new Date().toISOString()
      });
      
      // Send notification to farmer
      await notificationQueue.add("send-sms", {
        phoneNumber: "+254712345678",
        message: `🚨 Low soil moisture detected (${moistureLevel.toFixed(1)}%). Auto-irrigation started.`,
        farmId
      });
    }
    
    return { moistureLevel, status: "collected" };
  });

  iotSensorQueue.process("collect-weather-data", async (job) => {
    console.log("🌤️ Collecting weather data");
    // Weather data processing logic
    return { temperature: 25, humidity: 65, rainfall: 0 };
  });

  // Irrigation Control Processors
  irrigationQueue.process("start-irrigation", async (job) => {
    const { farmId, zone, reason } = job.data;
    console.log(`💧 Starting irrigation for ${farmId} ${zone} - ${reason}`);
    
    // Simulate irrigation control
    // In real implementation, this would interface with IoT irrigation systems
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return { status: "irrigation_started", duration: "30_minutes" };
  });

  irrigationQueue.process("assess-irrigation-needs", async (job) => {
    const { farmId, zones } = job.data;
    console.log(`🔍 Assessing irrigation needs for ${farmId}`);
    
    // Check each zone and start irrigation if needed
    for (const zone of zones) {
      const moistureLevel = Math.random() * 100;
      if (moistureLevel < 35) {
        await irrigationQueue.add("start-irrigation", {
          farmId,
          zone,
          reason: "scheduled_assessment",
          moistureLevel
        });
      }
    }
    
    return { status: "assessment_complete", zones_checked: zones.length };
  });

  // Market Data Processors
  marketDataQueue.process("fetch-market-prices", async (job) => {
    const { crops, markets } = job.data;
    console.log("📈 Fetching market prices");
    
    // Simulate price fetching
    const prices = {};
    for (const crop of crops) {
      prices[crop] = Math.random() * 100 + 50; // KES per kg
    }
    
    // Check for significant price changes and notify farmers
    if (prices.maize > 80) {
      await notificationQueue.add("send-sms", {
        phoneNumber: "+254712345678",
        message: `📈 Maize prices up! Current: ${prices.maize.toFixed(0)} KES/kg. Consider selling.`,
        type: "market_alert"
      });
    }
    
    return { prices, markets_checked: markets.length };
  });

  // Maintenance Processors
  maintenanceQueue.process("check-equipment-status", async (job) => {
    const { farmId, equipment } = job.data;
    console.log(`🔧 Checking equipment status for ${farmId}`);
    
    // Simulate equipment health checks
    const healthChecks = {};
    for (const item of equipment) {
      const health = Math.random() * 100;
      healthChecks[item] = health;
      
      // Alert if equipment health is poor
      if (health < 40) {
        await notificationQueue.add("send-sms", {
          phoneNumber: "+254712345678",
          message: `⚠️ ${item.replace('-', ' ')} needs maintenance (${health.toFixed(0)}% health)`,
          type: "maintenance_alert"
        });
      }
    }
    
    return { healthChecks, status: "complete" };
  });

  // Notification Processors (Africa's Talking integration)
  notificationQueue.process("send-sms", async (job) => {
    const { phoneNumber, message, type } = job.data;
    console.log(`📱 Sending SMS to ${phoneNumber}: ${message}`);
    
    // Here you would integrate with Africa's Talking SMS API
    // const response = await africasTalking.sendSMS(phoneNumber, message);
    
    return { status: "sent", provider: "africas_talking" };
  });

  // ===========================================
  // LOCCI SCHEDULER SETUP
  // ===========================================

  const setupScheduledTasks = async () => {
    try {
      console.log("🚀 Setting up Locci Scheduler tasks...");

      // IoT sensor data collection every 15 minutes
      await scheduler.scheduleInterval({
        name: "IoT Sensor Data Collection",
        description: "Collect soil moisture, weather, and crop health data",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/collect-sensor-data`,
          method: "POST",
          payload: { source: "locci_scheduler" }
        },
        intervalSeconds: 900 // 15 minutes
      });

      // Irrigation assessment every 2 hours during daylight
      await scheduler.scheduleInterval({
        name: "Irrigation Assessment", 
        description: "Check irrigation needs across all farm zones",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/irrigation-check`,
          method: "POST",
          payload: { source: "locci_scheduler" }
        },
        intervalSeconds: 7200 // 2 hours
      });

      // Market price updates twice daily
      await scheduler.scheduleInterval({
        name: "Market Price Updates",
        description: "Fetch latest crop prices from major markets", 
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/market-prices`,
          method: "POST",
          payload: { source: "locci_scheduler" }
        },
        intervalSeconds: 43200 // 12 hours
      });

      // Equipment maintenance check weekly
      await scheduler.scheduleInterval({
        name: "Equipment Maintenance Check",
        description: "Weekly health check of all farm equipment",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/maintenance-check`, 
          method: "POST",
          payload: { source: "locci_scheduler" }
        },
        intervalSeconds: 604800 // 7 days
      });

      console.log("✅ All Locci Scheduler tasks configured successfully!");

    } catch (error) {
      console.error("❌ Failed to setup scheduled tasks:", error);
    }
  };

  // Initialize scheduled tasks after server starts
  setTimeout(setupScheduledTasks, 2000);

  // ===========================================
  // START SERVER
  // ===========================================

  const { PORT = 5151 } = process.env;
  app.listen(PORT, () => {
    console.info(`🌾 Locci Farm IoT service running on port ${PORT}`);
    console.info(`📊 Bull Dashboard: http://localhost:${PORT}/admin/queues`);
    console.info(`🔗 Webhook base: ${process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`}`);
    console.info("📡 Make sure Redis is running for BullMQ");
    console.info("⏰ Make sure Locci Scheduler service is running");
  });
})();