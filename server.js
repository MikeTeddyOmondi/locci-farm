import express, { json } from "express";
import { config } from "dotenv";
import Queue from "bull";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { BullAdapter } from "@bull-board/api/bullAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import { LocciScheduler } from "@locci-scheduler/client";
import AfricasTalking from "africastalking";

(async () => {
  config();

  // Initialize Africa's Talking
  const africasTalking = AfricasTalking({
    apiKey: process.env.AFRICAS_TALKING_API_KEY,
    username: process.env.AFRICAS_TALKING_USERNAME,
  });

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
    "iot-sensors", // IoT sensor data processing
    "irrigation", // Irrigation control commands
    "market-data", // Market price updates
    "maintenance", // Equipment maintenance alerts
    "notifications", // SMS/USSD notifications via Africa's Talking
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
  app.use(express.static("public")); // Set static folder
  app.use(
    cors({
      origin: "*",
      credentials: true,
    })
  );

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
        timestamp: new Date().toISOString(),
      });

      await iotSensorQueue.add("collect-weather-data", {
        farmId: "farm-001",
        sensorType: "weather",
        timestamp: new Date().toISOString(),
      });

      await iotSensorQueue.add("collect-crop-health", {
        farmId: "farm-001",
        sensorType: "crop_health",
        timestamp: new Date().toISOString(),
      });

      res.json({
        status: "success",
        message: "IoT data collection jobs queued",
      });
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
        timestamp: new Date().toISOString(),
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
        timestamp: new Date().toISOString(),
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
        timestamp: new Date().toISOString(),
      });

      res.json({ status: "success", message: "Maintenance check queued" });
    } catch (error) {
      console.error("Maintenance check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Manual SMS Testing Endpoint
  app.post("/webhooks/test-sms", async (req, res) => {
    try {
      const { message, phoneNumber, type } = req.body;
      console.log("📱 Manual SMS test triggered");

      await notificationQueue.add("send-sms", {
        phoneNumber: phoneNumber || process.env.FARMER_PHONE || "+254717135176",
        message:
          message ||
          "🧪 Test SMS from Locci Farm IoT system - all systems operational!",
        type: type || "test",
        timestamp: new Date().toISOString(),
      });

      res.json({ status: "success", message: "Test SMS queued" });
    } catch (error) {
      console.error("Test SMS error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // System Status Endpoint
  app.get("/api/status", async (req, res) => {
    try {
      const queueStatus = {
        iotSensors: await iotSensorQueue.getJobCounts(),
        irrigation: await irrigationQueue.getJobCounts(),
        marketData: await marketDataQueue.getJobCounts(),
        maintenance: await maintenanceQueue.getJobCounts(),
        notifications: await notificationQueue.getJobCounts(),
      };

      // Send system status notification
      await sendTaskNotification("system_status", {
        message: "System status check requested",
        systemsHealthy: true,
        queues: Object.keys(queueStatus).length,
        timestamp: new Date().toISOString(),
      });

      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        queues: queueStatus,
        environment: {
          farmId: process.env.FARM_ID || "farm-001",
          webhookBase: process.env.WEBHOOK_BASE_URL,
          redisHost: process.env.REDIS_HOST,
        },
      });
    } catch (error) {
      console.error("Status check error:", error);
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
    const temperature = Math.random() * 15 + 20; // 20-35°C
    const humidity = Math.random() * 40 + 40; // 40-80%

    // Send sensor data collection notification
    await sendTaskNotification("sensor_data_collected", {
      farmId,
      sensorType,
      moistureLevel,
      temperature,
      humidity,
    });

    // If moisture is low, trigger irrigation
    if (
      moistureLevel < parseFloat(process.env.SOIL_MOISTURE_LOW_THRESHOLD) ||
      30
    ) {
      await irrigationQueue.add("start-irrigation", {
        farmId,
        zone: "zone-a",
        reason: "low_soil_moisture",
        moistureLevel,
        timestamp: new Date().toISOString(),
      });

      // Send low moisture alert
      await sendTaskNotification("irrigation_started", {
        farmId,
        zone: "zone-a",
        reason: "low_soil_moisture",
        moistureLevel,
        duration: "30 minutes",
      });
    }

    return { moistureLevel, temperature, humidity, status: "collected" };
  });

  iotSensorQueue.process("collect-weather-data", async (job) => {
    console.log("🌤️ Collecting weather data");

    // Simulate weather data collection
    const temperature = Math.random() * 15 + 20; // 20-35°C
    const humidity = Math.random() * 40 + 40; // 40-80%
    const rainfall = Math.random() * 10; // 0-10mm
    const windSpeed = Math.random() * 20 + 5; // 5-25 km/h

    // Check for extreme weather conditions
    const tempThreshold =
      parseFloat(process.env.TEMPERATURE_HIGH_THRESHOLD) || 35;
    const humidityThreshold =
      parseFloat(process.env.HUMIDITY_LOW_THRESHOLD) || 40;

    if (temperature > tempThreshold) {
      await sendTaskNotification("weather_warning", {
        farmId: job.data.farmId,
        warning: "High temperature alert",
        temperature,
        forecast: "Consider shade protection for sensitive crops",
      });
    }

    if (humidity < humidityThreshold) {
      await sendTaskNotification("weather_warning", {
        farmId: job.data.farmId,
        warning: "Low humidity alert",
        humidity,
        forecast: "Increase irrigation frequency",
      });
    }

    return { temperature, humidity, rainfall, windSpeed };
  });

  iotSensorQueue.process("collect-crop-health", async (job) => {
    const { farmId, sensorType } = job.data;
    console.log(`🌱 Processing ${sensorType} data for ${farmId}`);

    // Simulate crop health metrics
    const leafHealth = Math.random() * 100;
    const growthRate = Math.random() * 10 + 5; // 5-15 cm/week
    const pestActivity = Math.random() * 100;
    const diseaseRisk = Math.random() * 100;

    // Check for crop health issues
    if (leafHealth < 60) {
      await sendTaskNotification("weather_warning", {
        farmId,
        warning: "Poor crop health detected",
        leafHealth: leafHealth.toFixed(1),
        forecast: "Consider nutrient supplementation or pest control",
      });
    }

    if (pestActivity > 70) {
      await sendTaskNotification("weather_warning", {
        farmId,
        warning: "High pest activity detected",
        pestActivity: pestActivity.toFixed(1),
        forecast: "Apply pest control measures immediately",
      });
    }

    return {
      leafHealth,
      growthRate,
      pestActivity,
      diseaseRisk,
      status: "analyzed",
    };
  });

  // Irrigation Control Processors
  irrigationQueue.process("start-irrigation", async (job) => {
    const { farmId, zone, reason, moistureLevel } = job.data;
    console.log(`💧 Starting irrigation for ${farmId} ${zone} - ${reason}`);

    // Simulate irrigation control
    const beforeLevel = moistureLevel || Math.random() * 40 + 20;
    const afterLevel = beforeLevel + Math.random() * 30 + 20;
    const duration = "30 minutes";

    // In real implementation, this would interface with IoT irrigation systems
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send irrigation completion notification
    await sendTaskNotification("irrigation_completed", {
      farmId,
      zone,
      beforeLevel,
      afterLevel,
      duration,
    });

    return {
      status: "irrigation_completed",
      duration,
      moistureImprovement: afterLevel - beforeLevel,
    };
  });

  irrigationQueue.process("assess-irrigation-needs", async (job) => {
    const { farmId, zones } = job.data;
    console.log(`🔍 Assessing irrigation needs for ${farmId}`);

    let zonesNeedingIrrigation = 0;

    // Check each zone and start irrigation if needed
    for (const zone of zones) {
      const moistureLevel = Math.random() * 100;
      const threshold =
        parseFloat(process.env.SOIL_MOISTURE_LOW_THRESHOLD) || 35;

      if (moistureLevel < threshold) {
        zonesNeedingIrrigation++;
        await irrigationQueue.add("start-irrigation", {
          farmId,
          zone,
          reason: "scheduled_assessment",
          moistureLevel,
        });
      }
    }

    // Send assessment completion notification
    await sendTaskNotification("task_completed", {
      farmId,
      taskName: "Irrigation Assessment",
      status: `${zonesNeedingIrrigation}/${zones.length} zones need watering`,
      zonesChecked: zones.length,
      zonesNeedingIrrigation,
    });

    return {
      status: "assessment_complete",
      zones_checked: zones.length,
      zones_needing_irrigation: zonesNeedingIrrigation,
    };
  });

  // Market Data Processors
  marketDataQueue.process("fetch-market-prices", async (job) => {
    const { crops, markets } = job.data;
    console.log("📈 Fetching market prices");

    // Simulate price fetching
    const prices = {};
    const priceAlerts = [];

    for (const crop of crops) {
      const basePrice = crop === "maize" ? 70 : crop === "beans" ? 110 : 55;
      const currentPrice = basePrice + (Math.random() - 0.5) * 30;
      prices[crop] = currentPrice;

      // Check thresholds from environment variables
      const thresholdKey = `${crop.toUpperCase()}_PRICE_ALERT_THRESHOLD`;
      const threshold = parseFloat(process.env[thresholdKey]) || basePrice + 10;

      if (currentPrice > threshold) {
        priceAlerts.push({
          crop,
          price: currentPrice,
          threshold,
          trend: "up",
          market: markets[0] || "Nairobi",
          recommendation: "Consider selling - good market price!",
        });
      } else if (currentPrice < threshold * 0.7) {
        priceAlerts.push({
          crop,
          price: currentPrice,
          threshold,
          trend: "down",
          market: markets[0] || "Nairobi",
          recommendation: "Hold stock - wait for better prices",
        });
      }
    }

    // Send price alerts
    for (const alert of priceAlerts) {
      await sendTaskNotification("market_price_alert", alert);
    }

    // Send general market update
    await sendTaskNotification("task_completed", {
      taskName: "Market Price Update",
      status: `Checked ${crops.length} crops, ${priceAlerts.length} alerts`,
      prices,
      marketsChecked: markets.length,
    });

    return {
      prices,
      markets_checked: markets.length,
      alerts_sent: priceAlerts.length,
    };
  });

  // Maintenance Processors
  maintenanceQueue.process("check-equipment-status", async (job) => {
    const { farmId, equipment } = job.data;
    console.log(`🔧 Checking equipment status for ${farmId}`);

    // Simulate equipment health checks
    const healthChecks = {};
    const maintenanceAlerts = [];
    const failureAlerts = [];

    for (const item of equipment) {
      const health = Math.random() * 100;
      healthChecks[item] = health;

      // Critical failure (immediate attention)
      if (health < 20) {
        failureAlerts.push({
          farmId,
          equipment: item.replace("-", " "),
          health: health.toFixed(0),
        });
      }
      // Maintenance required (schedule soon)
      else if (health < 40) {
        maintenanceAlerts.push({
          farmId,
          equipment: item.replace("-", " "),
          health: health.toFixed(0),
        });
      }
    }

    // Send failure alerts (urgent)
    for (const alert of failureAlerts) {
      await sendTaskNotification("equipment_failure", alert);
    }

    // Send maintenance alerts
    for (const alert of maintenanceAlerts) {
      await sendTaskNotification("maintenance_required", alert);
    }

    // Send overall maintenance check completion
    await sendTaskNotification("task_completed", {
      farmId,
      taskName: "Equipment Maintenance Check",
      status: `${equipment.length} items checked, ${
        maintenanceAlerts.length + failureAlerts.length
      } alerts`,
      equipmentChecked: equipment.length,
      alertsGenerated: maintenanceAlerts.length + failureAlerts.length,
    });

    return {
      healthChecks,
      status: "complete",
      maintenance_alerts: maintenanceAlerts.length,
      failure_alerts: failureAlerts.length,
    };
  });

  // Notification Processors (Africa's Talking integration)
  notificationQueue.process("send-sms", async (job) => {
    const { phoneNumber, message, type, data } = job.data;
    console.log(`📱 Sending SMS to ${phoneNumber}: ${message}`);

    try {
      // Use Africa's Talking SMS API
      const smsService = africasTalking.SMS;

      const options = {
        to: phoneNumber,
        message: message,
        // from: process.env.AFRICAS_TALKING_SENDER_ID || null,
      };

      const response = await smsService.send(options);

      console.log(`✅ SMS sent successfully:`, response);

      return {
        status: "sent",
        provider: "africas_talking",
        response: response.SMSMessageData,
        messageId: response.SMSMessageData.Recipients[0]?.messageId,
        cost: response.SMSMessageData.Recipients[0]?.cost,
      };
    } catch (error) {
      console.error(`❌ Failed to send SMS:`, error);

      // Return error details for monitoring
      return {
        status: "failed",
        provider: "africas_talking",
        error: error.message,
        phoneNumber,
        messageType: type,
      };
    }
  });

  // Enhanced notification helper functions
  const sendTaskNotification = async (taskType, details) => {
    const farmerPhone = process.env.FARMER_PHONE || "+254717135176";
    let message = "";

    switch (taskType) {
      case "sensor_data_collected":
        message =
          `🌱 FARM UPDATE: Sensor data collected at ${new Date().toLocaleTimeString()}. ` +
          `Soil: ${details.moistureLevel?.toFixed(1)}%, Weather: ${
            details.temperature
          }°C`;
        break;

      case "irrigation_started":
        message =
          `💧 IRRIGATION ALERT: Auto-irrigation started in ${details.zone}. ` +
          `Reason: ${details.reason.replace("_", " ")}. Duration: ${
            details.duration || "30 min"
          }`;
        break;

      case "irrigation_completed":
        message =
          `✅ IRRIGATION COMPLETE: ${details.zone} watering finished. ` +
          `Soil moisture improved from ${details.beforeLevel}% to ${details.afterLevel}%`;
        break;

      case "market_price_alert":
        message =
          `📈 MARKET ALERT: ${details.crop} price ${
            details.trend === "up" ? "increased" : "decreased"
          } to ` +
          `${details.price} KES/kg in ${details.market}. ${details.recommendation}`;
        break;

      case "maintenance_required":
        message =
          `🔧 MAINTENANCE ALERT: ${details.equipment} requires attention. ` +
          `Health: ${details.health}%. Schedule maintenance soon to avoid breakdown.`;
        break;

      case "equipment_failure":
        message =
          `🚨 URGENT: ${details.equipment} has failed! ` +
          `Immediate attention required. Contact technician: +254700123456`;
        break;

      case "weather_warning":
        message =
          `🌦️ WEATHER WARNING: ${details.warning} expected. ` +
          `Take protective measures for crops. Updated forecast: ${details.forecast}`;
        break;

      case "task_completed":
        message =
          `✅ TASK COMPLETE: ${
            details.taskName
          } finished successfully at ${new Date().toLocaleTimeString()}. ` +
          `Status: ${details.status}`;
        break;

      case "system_status":
        message =
          `📊 SYSTEM UPDATE: ${details.message}. ` +
          `All systems ${
            details.systemsHealthy ? "operating normally" : "require attention"
          }.`;
        break;

      default:
        message = details.customMessage || `📱 Farm notification: ${taskType}`;
    }

    // Add farm ID and timestamp
    message += ` [Farm: ${details.farmId || "farm-001"}]`;

    await notificationQueue.add("send-sms", {
      phoneNumber: farmerPhone,
      message,
      type: taskType,
      data: details,
      timestamp: new Date().toISOString(),
    });
  };

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
          payload: { source: "locci_scheduler" },
        },
        intervalSeconds: 120, // 2 minutes
      });

      // Irrigation assessment every 2 hours during daylight
      await scheduler.scheduleInterval({
        name: "Irrigation Assessment",
        description: "Check irrigation needs across all farm zones",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/irrigation-check`,
          method: "POST",
          payload: { source: "locci_scheduler" },
        },
        intervalSeconds: 300, // 5 minutes
      });

      // Market price updates twice daily
      await scheduler.scheduleInterval({
        name: "Market Price Updates",
        description: "Fetch latest crop prices from major markets",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/market-prices`,
          method: "POST",
          payload: { source: "locci_scheduler" },
        },
        intervalSeconds: 300, // 5 minutes
      });

      // Equipment maintenance check weekly
      await scheduler.scheduleInterval({
        name: "Equipment Maintenance Check",
        description: "Weekly health check of all farm equipment",
        webhook: {
          url: `${process.env.WEBHOOK_BASE_URL}/webhooks/maintenance-check`,
          method: "POST",
          payload: { source: "locci_scheduler" },
        },
        intervalSeconds: 300, // 5 minutes
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
    console.info(
      `🔗 Webhook base: ${
        process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`
      }`
    );
    console.info("📡 Make sure Redis is running for BullMQ");
    console.info("⏰ Make sure Locci Scheduler service is running");
  });
})();
